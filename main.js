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



// 將 ModBundle 目錄設在 userData（可寫入）資料夾下
const modBundleDir = path.join(app.getPath('userData'), 'ModBundle');
if (!fs.existsSync(modBundleDir)) {
	fs.mkdirSync(modBundleDir, { recursive: true });
}


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


app.whenReady().then(async () => {
	// 初始化 i18next
	i18next.use(Backend).init({
		lng: app.getLocale(), // 使用應用程式的語言設定
		fallbackLng: 'en',
		backend: {
			loadPath: path.join(__dirname, 'locales/{{lng}}/{{ns}}.json'),
		},
		ns: ['translation'],
		defaultNS: 'translation',
	});

	// 等待 i18next 初始化完成
	await new Promise(resolve => {
		i18next.on('initialized', resolve);
	});

	// 啟動時顯示免責聲明彈窗
	await dialog.showMessageBox({
		type: 'warning',
		title: i18next.t('disclaimer_title'),
		message: i18next.t('disclaimer_message'),
		buttons: [i18next.t('disclaimer_button')],
		defaultId: 0
	});

	ipcMain.handle('game:launch', async () => {
		// Steam 的 Blue Archive appid: 3557620
		const steamUrl = 'steam://run/3557620';
		const { shell } = require('electron');
		await shell.openExternal(steamUrl);
		return true;
	});
	ipcMain.handle('dialog:openFile', async () => {
		const { canceled, filePaths } = await dialog.showOpenDialog({
			title: i18next.t('select_file_button'),
			properties: ['openFile', 'multiSelections'],
			filters: [{ name: 'Bundle Files', extensions: ['bundle'] }]
		});

		if (canceled || filePaths.length === 0) {
			return null;
		}

		const currentMods = store.get('mods', []);
		const errors = [];

		// 確保 ModBundle 目錄存在（防止打包後第一次啟動未建立）
		if (!fs.existsSync(modBundleDir)) {
			try {
				fs.mkdirSync(modBundleDir, { recursive: true });
			} catch (err) {
				return { mods: currentMods, errors: [i18next.t('modbundle_create_failed') + ': ' + err.message] };
			}
		}

		for (const filePath of filePaths) {
			const fileName = path.basename(filePath);
			const newPath = path.join(modBundleDir, fileName);

			if (currentMods.some(mod => mod.fileName === fileName)) {
				continue;
			}

			if (!fs.existsSync(filePath)) {
				errors.push(`${fileName}: ${i18next.t('file_not_found')}`);
				continue;
			}

			try {
				fs.copyFileSync(filePath, newPath);
				currentMods.push({
					id: crypto.randomUUID(),
					fileName: fileName,
					modName: fileName.replace(/\.bundle$/i, ''),
					enabled: true,
					path: newPath,
				});
			} catch (err) {
				errors.push(`${fileName}: ${err.message}`);
			}
		}

		store.set('mods', currentMods);
		// 若有錯誤，回傳錯誤訊息與成功的 mod 列表
		if (errors.length > 0) {
			return { mods: currentMods, errors };
		}
		return currentMods;
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
	ipcMain.handle('mods:apply', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const gameBundlePath = store.get('gameBundlePath');

		if (!gameBundlePath || !fs.existsSync(gameBundlePath)) {
			return { success: false, message: i18next.t('game_path_not_configured') };
		}

		const res = await dialog.showMessageBox(win, {
			type: 'warning',
			buttons: [i18next.t('button_cancel'), i18next.t('button_apply')],
			defaultId: 0,
			title: i18next.t('apply_mods_confirm_title'),
			message: i18next.t('apply_mods_confirm_message'),
			cancelId: 0,
		});

		if (res.response === 0) { // 使用者點擊了 Cancel
			return { success: false, message: i18next.t('operation_cancelled') };
		}

		const modsToApply = store.get('mods', []).filter(m => m.enabled);
		let operationsLog = [];

		for (const mod of modsToApply) {
			const targetPath = path.join(gameBundlePath, mod.fileName);
			const backupPath = `${targetPath}.bak`;

			try {
				// 1. 備份原始檔案 (如果存在且尚未備份)
				if (fs.existsSync(targetPath) && !fs.existsSync(backupPath)) {
					fs.renameSync(targetPath, backupPath);
					operationsLog.push(`Backed up: ${mod.fileName}`);
				}
				// 2. 複製 Mod 檔案
				fs.copyFileSync(mod.path, targetPath);
				operationsLog.push(`Applied: ${mod.fileName}`);
			} catch (err) {
				console.error(`Failed to apply mod ${mod.fileName}:`, err);
				operationsLog.push(`Error applying ${mod.fileName}: ${err.message}`);
				return { success: false, message: i18next.t('operation_failed'), log: operationsLog };
			}
		}
		console.log(operationsLog);
		return { success: true, message: i18next.t('operation_success'), log: operationsLog };
	});


	ipcMain.handle('mods:uninstall', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const gameBundlePath = store.get('gameBundlePath');

		if (!gameBundlePath || !fs.existsSync(gameBundlePath)) {
			return { success: false, message: i18next.t('game_path_not_configured') };
		}

		const res = await dialog.showMessageBox(win, {
			type: 'warning',
			buttons: [i18next.t('button_cancel'), i18next.t('button_apply')],
			defaultId: 0,
			title: i18next.t('uninstall_mods_confirm_title'),
			message: i18next.t('uninstall_mods_confirm_message'),
			cancelId: 0,
		});

		if (res.response === 0) {
			return { success: false, message: i18next.t('operation_cancelled') };
		}

		const modsToUninstall = store.get('mods', []).filter(m => !m.enabled);
		let operationsLog = [];

		for (const mod of modsToUninstall) {
			const targetPath = path.join(gameBundlePath, mod.fileName);
			const backupPath = `${targetPath}.bak`;

			try {
				// 1. 刪除已應 ThemeData 的 Mod 檔案
				if (fs.existsSync(targetPath)) {
					fs.unlinkSync(targetPath);
					operationsLog.push(`Removed mod file: ${mod.fileName}`);
				}
				// 2. 還原備份
				if (fs.existsSync(backupPath)) {
					fs.renameSync(backupPath, targetPath);
					operationsLog.push(`Restored original: ${mod.fileName}`);
				}
			} catch (err) {
				console.error(`Failed to uninstall mod ${mod.fileName}:`, err);
				operationsLog.push(`Error uninstalling ${mod.fileName}: ${err.message}`);
				return { success: false, message: i18next.t('operation_failed'), log: operationsLog };
			}
		}
		console.log(operationsLog);
		return { success: true, message: i18next.t('operation_success'), log: operationsLog };
	});
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
