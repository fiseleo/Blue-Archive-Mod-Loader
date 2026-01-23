const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store').default;
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');

// 導入模塊
const devtoolsModule = require('./modules/DevTools');
const Utils = require('./modules/Utils');
const GamePathManager = require('./modules/GamePathManager');
const StudentIndexManager = require('./modules/StudentIndexManager');
const ModManager = require('./modules/ModManager');
const IPCHandler = require('./modules/IPCHandler');

// 設定控制台編碼
Utils.setupConsoleEncoding();

// 應用程序狀態
const store = new Store();
let isAppInitializing = true;

function broadcastGamePathUpdate(paths) {
	if (!paths) {
		return;
	}
	BrowserWindow.getAllWindows()
		.filter((window) => !window.isDestroyed())
		.forEach((window) => {
			window.webContents.send('update-game-path', paths);
		});
}

// 模塊實例
let gamePathManager;
let studentIndexManager;
let modManager;
let ipcHandler;

/**
 * 創建主視窗
 */
function createWindow() {
	const win = new BrowserWindow({
		width: 800,
		height: 600,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
		},
	});

	win.loadFile('index.html');
	win.setMenu(null);
	
	devtoolsModule.EnableDevTools(app.isPackaged, win);
	win.webContents.on('did-finish-load', async () => {
		let gamePath = store.get('gamePath');
		let gameBundlePath = store.get('gameBundlePath');

		if (gamePath && fs.existsSync(gamePath)) {
			broadcastGamePathUpdate({ gamePath, gameBundlePath });
			return;
		}

		const paths = await gamePathManager.findGameExecutable(win);

		if (paths) {
			broadcastGamePathUpdate(paths);
		} else {
			const { canceled, filePaths } = await dialog.showOpenDialog(win, {
				title: i18next.t('select_game_executable'),
				properties: ['openFile'],
				filters: [{ name: 'BlueArchive Executable', extensions: ['exe'] }]
			});
			if (!canceled) {
				const manualPaths = gamePathManager.saveGamePaths(filePaths[0]);
				if (manualPaths) {
					broadcastGamePathUpdate(manualPaths);
				}
			}
		}
	});
}


app.whenReady().then(async () => {
	try {
		// 初始化所有模塊
		gamePathManager = new GamePathManager(store, i18next);
		studentIndexManager = new StudentIndexManager(app);
		modManager = new ModManager(store, app, i18next);
		
		// 初始化學生索引（進度條將在這裡顯示）
		await studentIndexManager.updateStudentIndex();
		
		// 初始化 i18next
		i18next.use(Backend).init({
			lng: app.getLocale(),
			fallbackLng: 'en',
			backend: {
				loadPath: path.join(__dirname, 'locales/{{lng}}/{{ns}}.json'),
			},
			ns: ['translation'],
			defaultNS: 'translation',
		});

		await new Promise(resolve => {
			i18next.on('initialized', resolve);
		});

		// 先顯示免責聲明對話框（在學生索引更新後）
		await dialog.showMessageBox({
			type: 'warning',
			title: i18next.t('disclaimer_title'),
			message: i18next.t('disclaimer_message'),
			buttons: [i18next.t('disclaimer_button')],
			defaultId: 0
		});

		// 初始化 IPC 處理程序
		ipcHandler = new IPCHandler(store, app, i18next, gamePathManager, modManager, studentIndexManager);

		// 建立主視窗
		createWindow();

	} catch (error) {
		console.error('Application initialization failed:', error);
		// 如果初始化失敗，仍然嘗試建立主視窗
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	} finally {
		isAppInitializing = false;
	}

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on('will-quit', () => {
	devtoolsModule.DisableDevTools();
});

app.on('window-all-closed', () => {
	if (isAppInitializing) {
		return;
	}
	if (process.platform !== 'darwin') {
		app.quit();
	}
});