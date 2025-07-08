const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store').default;
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const fg = require('fast-glob');
const drivelist = require('drivelist');
const crypto = require('crypto');
const store = new Store();


const modBundleDir = path.join(app.getAppPath(), 'ModBundle');
if (!fs.existsSync(modBundleDir)) {
	fs.mkdirSync(modBundleDir, { recursive: true });
}

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
	});

async function getDriveLetters() {
	try {
		const drives = await drivelist.list();

		console.log('--- Drivelist Raw Output ---');
		console.log(drives);



		const drivePaths = drives
			.filter(drive => drive.mountpoints && drive.mountpoints.length > 0)
			.flatMap(drive => drive.mountpoints.map(mp => `${mp.path.replace(/\\/g, '/')}/`));


		console.log('--- Filtered Drive Paths for Scanning ---');
		console.log(drivePaths);

		return drivePaths;

	} catch (error) {
		console.error('Failed to get drive letters with drivelist:', error);
		return ['C:/', 'D:/', 'E:/'];
	}
}

async function findGameExecutable(win) {
	win.webContents.send('update-status', i18next.t('status_preparing_search'));
	const searchPaths = await getDriveLetters();
	win.webContents.send('update-status', i18next.t('status_drives_found', { drives: searchPaths.join(', ') }));

	await new Promise(resolve => setTimeout(resolve, 1000));

	for (const searchPath of searchPaths) {
		try {
			win.webContents.send('update-status', i18next.t('status_scanning_drive', { drive: searchPath }));

			const entries = await fg('**/BlueArchive.exe', {
				cwd: searchPath,
				deep: 7, // 增加搜尋深度，但仍設有上限以防無窮迴圈
				onlyFiles: true,
				caseSensitiveMatch: false,
				suppressErrors: true, // 忽略權限不足等讀取錯誤
				ignore: [
					'**/$RECYCLE.BIN/**',
					'**/System Volume Information/**',
					'**/Windows/**',
					'**/ProgramData/**',
					'**/$WinREAgent/**',
					'**/Recovery/**'
				],
			});

			if (entries.length > 0) {
				const foundPath = path.join(searchPath, entries[0]);
				saveGamePaths(foundPath);
				win.webContents.send('update-status', i18next.t('status_found', { path: foundPath }));
				return { gamePath: store.get('gamePath'), gameBundlePath: store.get('gameBundlePath') };
			}
		} catch (err) {
			console.error(`Error searching in ${searchPath}:`, err);
		}
	}

	win.webContents.send('update-status', i18next.t('status_not_found'));
	return null;
}

// saveGamePaths, selectGamePath, createWindow 和 app 事件處理等其餘程式碼保持不變
function saveGamePaths(executablePath) {
	const gameDirectory = path.dirname(executablePath);
	const bundlePath = path.join(gameDirectory, 'BlueArchive_Data', 'StreamingAssets', 'PUB', 'Resource', 'GameData', 'Windows');
	store.set({ gamePath: executablePath, gameBundlePath: bundlePath });
	return { gamePath: executablePath, gameBundlePath: bundlePath };
}

async function selectGamePath(win) {
	const { canceled, filePaths } = await dialog.showOpenDialog(win, {
		title: i18next.t('select_game_executable'),
		properties: ['openFile'],
		filters: [{ name: 'BlueArchive Executable', extensions: ['exe'] }]
	});
	if (!canceled) {
		return saveGamePaths(filePaths[0]);
	}
}

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

	win.webContents.on('did-finish-load', async () => {
		let gamePath = store.get('gamePath');
		let gameBundlePath = store.get('gameBundlePath');

		if (gamePath && fs.existsSync(gamePath)) {
			win.webContents.send('update-game-path', { gamePath, gameBundlePath });
			return;
		}

		const paths = await findGameExecutable(win);

		if (paths) {
			win.webContents.send('update-game-path', paths);
		} else {
			const manualPaths = await selectGamePath(win);
			if (manualPaths) {
				win.webContents.send('update-game-path', manualPaths);
			}
		}
	});
};

app.whenReady().then(() => {
	ipcMain.handle('dialog:openFile', async () => {
		const { canceled, filePaths } = await dialog.showOpenDialog({
			title: i18next.t('select_file_button'),
			properties: ['openFile', 'multiSelections'], // 允許選擇多個檔案
			filters: [{ name: 'Bundle Files', extensions: ['bundle'] }]
		});

		if (canceled || filePaths.length === 0) {
			return null;
		}

		const currentMods = store.get('mods', []);

		for (const filePath of filePaths) {
			const fileName = path.basename(filePath);
			const newPath = path.join(modBundleDir, fileName);


			if (currentMods.some(mod => mod.fileName === fileName)) {
				continue;
			}

			fs.copyFileSync(filePath, newPath);

			currentMods.push({
				id: crypto.randomUUID(), // 產生一個唯一的 ID
				fileName: fileName,
				modName: fileName.replace(/\.bundle$/i, ''), // 預設 Mod 名稱為檔名 (去掉副檔名)
				enabled: true, // 預設為啟用
				path: newPath,
			});
		}

		store.set('mods', currentMods); // 儲存更新後的列表
		return currentMods; // 回傳完整的 Mod 列表
	});

	ipcMain.handle('mods:get', () => {
		return store.get('mods', []);
	});

	ipcMain.handle('mods:update', (_event, updatedMod) => {
		let mods = store.get('mods', []);
		const modIndex = mods.findIndex(mod => mod.id === updatedMod.id);
		if (modIndex !== -1) {
			mods[modIndex] = { ...mods[modIndex], ...updatedMod };
			store.set('mods', mods);
		}
		return mods;
	});

	ipcMain.handle('mods:delete', (_event, modId) => {
		let mods = store.get('mods', []);
		const modToDelete = mods.find(mod => mod.id === modId);
		if (modToDelete) {
			try {
				if (fs.existsSync(modToDelete.path)) {
					fs.unlinkSync(modToDelete.path); // 從硬碟刪除檔案
				}
			} catch (err) {
				console.error(`Failed to delete mod file: ${modToDelete.path}`, err);
			}
		}
		const newMods = mods.filter(mod => mod.id !== modId);
		store.set('mods', newMods);
		return newMods;
	});

	ipcMain.handle('dialog:selectGamePath', (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		return selectGamePath(win);
	});
	ipcMain.handle('config:getGamePath', () => {
		return {
			gamePath: store.get('gamePath'),
			gameBundlePath: store.get('gameBundlePath'),
		};
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
