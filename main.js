const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store').default;
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');

const store = new Store();

//i18next 初始化
// 使用 i18next-fs-backend 來載入本地化文件
i18next
	.use(Backend)
	.init({
		lng: app.getLocale(),
		fallbackLng: 'en',
		backend: {
			loadPath: path.join(__dirname, 'locales/{{lng}}/{{ns}}.json'),
		},
		ns: ['translation'],
		defaultNS: 'translation',
	})




async function selectGamePath(win) {
	const { canceled, filePaths } = await dialog.showOpenDialog(win, {
		title: i18next.t('select_game_executable'), // 從 i18n 取得標題
		properties: ['openFile'],
		filters: [
			{ name: 'BlueArchive Executable', extensions: ['exe'] }
		]
	});
	if (!canceled) {
		const gamePath = filePaths[0];
		store.set('gamePath', gamePath); // 將路徑存到設定檔
		return gamePath; // 返回新路徑
	}
}

async function handleFileOpen() {
	const { canceled, filePaths } = await dialog.showOpenDialog({
		properties: ['openFile'],
		filters: [
			{ name: 'Bundle Files', extensions: ['bundle'] },
		]
	});
	if (!canceled) {
		return filePaths[0]; // 返回選擇的文件路徑
	}
}

const createWindow = () => {
	const win = new BrowserWindow({
		width: 800,
		height: 600,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
		},
	});

	win.loadFile('index.html');
	win.setMenu(null);

	// 應用程式啟動後，檢查路徑是否存在
	win.webContents.on('did-finish-load', () => {
		if (!store.get('gamePath')) {
			// 如果沒有儲存的路徑，就立即彈出視窗讓使用者選擇
			selectGamePath(win).then(newPath => {
				if (newPath) {
					// 將新路徑傳送給渲染行程去更新畫面
					win.webContents.send('update-game-path', newPath);
				}
			});
		}
	});
};



app.whenReady().then(() => {
	
	ipcMain.handle('dialog:openFile', handleFileOpen);

	
	ipcMain.handle('dialog:selectGamePath', (event) => {
		
		const win = BrowserWindow.fromWebContents(event.sender);
		return selectGamePath(win);
	});

	
	ipcMain.handle('config:getGamePath', () => {
		return store.get('gamePath');
	});

	ipcMain.handle('i18n:getLocale', () => app.getLocale());

	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});