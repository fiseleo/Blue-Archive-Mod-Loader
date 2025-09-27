const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store').default;
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const fg = require('fast-glob');
const drivelist = require('drivelist');
const crypto = require('crypto');
const { exec } = require('child_process');

// Set console encoding for Windows to properly display UTF-8 characters
if (process.platform === 'win32') {
    // Set Node.js output encoding
    if (process.stdout && process.stdout.setDefaultEncoding) {
        process.stdout.setDefaultEncoding('utf8');
    }
    if (process.stderr && process.stderr.setDefaultEncoding) {
        process.stderr.setDefaultEncoding('utf8');
    }
    
    // Set Windows console code page to UTF-8
    try {
        exec('chcp 65001 >nul 2>&1', (error) => {
            if (error) {
                console.log('Console encoding setup: Using default encoding');
            } else {
                console.log('Console encoding set to UTF-8');
            }
        });
    } catch (error) {
        console.log('Console encoding setup: Using default encoding');
    }
}

const store = new Store();

// Helper function to safely log to console without encoding issues
function safeLog(message, data = '') {
    try {
        if (data) {
            console.log(`${message}:`, data);
        } else {
            console.log(message);
        }
    } catch (error) {
        // Fallback for encoding issues
        console.log('Log output (encoding safe)');
    }
}

function safeWarn(message, data = '') {
    try {
        if (data) {
            console.warn(`${message}:`, data);
        } else {
            console.warn(message);
        }
    } catch (error) {
        // Fallback for encoding issues
        console.warn('Warning output (encoding safe)');
    }
}

function safeError(message, error = null) {
    try {
        if (error) {
            console.error(`${message}:`, error);
        } else {
            console.error(message);
        }
    } catch (err) {
        // Fallback for encoding issues
        console.error('Error output (encoding safe)');
    }
}

const SUPPORTED_EXTENSIONS = [
    '.ogg', 
    '.mp4', 
    '.jpg', 
    '.jpeg',
    '.png',
	'.bundle',
	'.zip',
	'.db'
];


let crcPatcher;
try {
    crcPatcher = require('./crc_patcher.js');
    console.log('CRC Patcher module loaded successfully.');
} catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
        console.warn('CRC Patcher module (crc_patcher.js) not found. Mods will be applied without CRC correction.');
        crcPatcher = {
            manipulate_crc: async () => {
                console.warn('CRC correction skipped because patcher module is missing.');
                return true;
            }
        };
    } else {
        throw e;
    }
}


const modBundleDir = path.join(app.getPath('userData'), 'ModBundle');
if (!fs.existsSync(modBundleDir)) {
	fs.mkdirSync(modBundleDir, { recursive: true });
}

async function findFileRecursively(directory, fileNameToFind) {
    try {
        const items = await fs.promises.readdir(directory, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(directory, item.name);
            if (item.isDirectory()) {
                const result = await findFileRecursively(fullPath, fileNameToFind);
                if (result) {
                    return result; 
                }
            } else if (item.name.toLowerCase() === fileNameToFind.toLowerCase()) {
                return fullPath; 
            }
        }
    } catch (err) {
    }
    return null; 
}


async function findTargetFile(modFileName, win) {
	const gamePath = store.get('gamePath');
	if (!gamePath) {
		console.warn('Game path not set in store.');
		return null;
	}

	const searchBase = path.join(path.dirname(gamePath), 'BlueArchive_Data');
	if (!fs.existsSync(searchBase)) {
		console.warn(`Search base directory does not exist: ${searchBase}`);
		return null;
	}

	win.webContents.send('update-action-status', i18next.t('status_searching_for_file', { file: modFileName }));
	console.log(`Searching for file: ${modFileName} in base directory: ${searchBase}`);

    const foundPath = await findFileRecursively(searchBase, modFileName);

	if (foundPath) {
		console.log(`File found: ${foundPath}`);
		return foundPath;
	}

	console.warn(`File not found: ${modFileName} in directory: ${searchBase}`);
	return null;
}


async function getSteamInstallPath() {
	return new Promise((resolve) => {

		const registryPath = 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam';
		const command = `reg query "${registryPath}" /v InstallPath`;
		exec(command, (error, stdout, stderr) => {
			if (error) {
				console.error(`查詢 Steam 64位元登錄檔失敗: ${error.message}`);
				const registryPath32 = 'HKLM\\SOFTWARE\\Valve\\Steam';
				const command32 = `reg query "${registryPath32}" /v InstallPath`;
				exec(command32, (error32, stdout32, stderr32) => {
					if (error32) {
						console.error(`查詢 Steam 32位元登錄檔失敗: ${error32.message}`);
						resolve(null);
						return;
					}
					const match32 = stdout32.match(/InstallPath\s+REG_SZ\s+(.*)/);
					resolve(match32 ? match32[1].trim() : null);
				});
				return;
			}
			const match = stdout.match(/InstallPath\s+REG_SZ\s+(.*)/);
			resolve(match ? match[1].trim() : null);
		});
	});
}


async function findGameViaSteam(win) {
	win.webContents.send('update-status', i18next.t('status_finding_steam'));
	const steamPath = await getSteamInstallPath();
	if (!steamPath) {
		console.log('在登錄檔中找不到 Steam 安裝路徑。');
		return null;
	}

	win.webContents.send('update-status', i18next.t('status_steam_found', { path: steamPath }));
	await new Promise(resolve => setTimeout(resolve, 1000));

	const libraryFoldersVdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
	if (!fs.existsSync(libraryFoldersVdfPath)) {
		console.log('找不到 libraryfolders.vdf 檔案。');
		return null;
	}

	try {
		const libraryFoldersContent = fs.readFileSync(libraryFoldersVdfPath, 'utf-8');
		const libraryPaths = [steamPath];
		const pathRegex = /"path"\s+"([^"]+)"/g;
		let match;
		while ((match = pathRegex.exec(libraryFoldersContent)) !== null) {
			const libPath = match[1].replace(/\\\\/g, '\\'); // 將 VDF 中的 \\ 轉為單一 \
			if (fs.existsSync(libPath)) {
				libraryPaths.push(libPath);
			}
		}

		const uniqueLibraryPaths = [...new Set(libraryPaths)];
		console.log('找到的 Steam 遊戲庫:', uniqueLibraryPaths);

		const appId = '3557620'; // 蔚藍檔案的 Steam App ID
		const manifestFile = `appmanifest_${appId}.acf`;

		for (const libPath of uniqueLibraryPaths) {
			const manifestPath = path.join(libPath, 'steamapps', manifestFile);
			win.webContents.send('update-status', i18next.t('status_checking_steam_library', { library: libPath }));

			if (fs.existsSync(manifestPath)) {
				const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
				const installDirMatch = manifestContent.match(/"installdir"\s+"([^"]+)"/);
				if (installDirMatch && installDirMatch[1]) {
					const installDir = installDirMatch[1];
					const gameExePath = path.join(libPath, 'steamapps', 'common', installDir, 'BlueArchive.exe');
					if (fs.existsSync(gameExePath)) {
						win.webContents.send('update-status', i18next.t('status_found_steam', { path: gameExePath }));
						await new Promise(resolve => setTimeout(resolve, 1500));
						return gameExePath;
					}
				}
			}
		}
	} catch (err) {
		console.error('在搜尋 Steam 遊戲過程中發生錯誤:', err);
	}

	return null;
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
	try {
		const steamGamePath = await findGameViaSteam(win);
		if (steamGamePath) {
			saveGamePaths(steamGamePath);
			win.webContents.send('update-status', i18next.t('status_found', { path: steamGamePath }));
			return { gamePath: store.get('gamePath'), gameBundlePath: store.get('gameBundlePath') };
		}
		win.webContents.send('update-status', i18next.t('status_steam_not_found_fallback'));
		await new Promise(resolve => setTimeout(resolve, 2000));
	} catch (err) {
		console.error('Steam 搜尋過程中發生錯誤:', err);
	}

	win.webContents.send('update-status', i18next.t('status_preparing_search'));
	const searchPaths = await getDriveLetters();
	win.webContents.send('update-status', i18next.t('status_drives_found', { drives: searchPaths.join(', ') }));

	await new Promise(resolve => setTimeout(resolve, 1000));

	for (const searchPath of searchPaths) {
		try {
			win.webContents.send('update-status', i18next.t('status_scanning_drive', { drive: searchPath }));

			const entries = await fg('**/BlueArchive.exe', {
				cwd: searchPath,
				deep: 7,
				onlyFiles: true,
				caseSensitiveMatch: false,
				suppressErrors: true,
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

function saveGamePaths(executablePath) {
	const gameDirectory = path.dirname(executablePath);
	const bundlePath = path.join(gameDirectory, 'BlueArchive_Data');
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

	await dialog.showMessageBox({
		type: 'warning',
		title: i18next.t('disclaimer_title'),
		message: i18next.t('disclaimer_message'),
		buttons: [i18next.t('disclaimer_button')],
		defaultId: 0
	});

	ipcMain.handle('game:launch', async () => {
		const steamUrl = 'steam://run/3557620';
		await shell.openExternal(steamUrl);
		return true;
	});
	ipcMain.handle('dialog:openFile', async () => {
		// Convert SUPPORTED_EXTENSIONS to filter format (remove dots)
		const supportedExts = SUPPORTED_EXTENSIONS.map(ext => ext.replace('.', ''));
		
		const { canceled, filePaths } = await dialog.showOpenDialog({
			title: i18next.t('select_file_button'),
			properties: ['openFile', 'multiSelections'],
			filters: [
				{ name: 'Mod Files', extensions: supportedExts },
				{ name: 'All Files', extensions: ['*'] }
			]
		});

		if (canceled || filePaths.length === 0) {
			return null;
		}

		const currentMods = store.get('mods', []);
		const errors = [];

		if (!fs.existsSync(modBundleDir)) {
			try {
				fs.mkdirSync(modBundleDir, { recursive: true });
			} catch (err) {
				return { mods: currentMods, errors: [i18next.t('modbundle_create_failed') + ': ' + err.message] };
			}
		}

		for (const filePath of filePaths) {
			const fileName = path.basename(filePath);
			let modName = fileName.replace(/\.bundle$/i, '');
			let finalPath = path.join(modBundleDir, fileName);
			
			// Check if a mod with the same filename already exists
			const existingMod = currentMods.find(mod => mod.fileName === fileName);
			if (existingMod) {
				// Generate a unique filename for this version
				const fileExt = path.extname(fileName);
				const baseName = path.basename(fileName, fileExt);
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				const newFileName = `${baseName}_v${timestamp}${fileExt}`;
				finalPath = path.join(modBundleDir, newFileName);
				modName = `${modName} (v${timestamp.substring(0, 16)})`;
				
				console.log(`Duplicate mod detected: ${fileName}. Creating new version: ${newFileName}`);
			}

			if (!fs.existsSync(filePath)) {
				errors.push(`${fileName}: ${i18next.t('file_not_found')}`);
				continue;
			}

			try {
				fs.copyFileSync(filePath, finalPath);
				currentMods.push({
					id: crypto.randomUUID(),
					fileName: fileName, // Keep original filename for conflict detection
					actualFileName: path.basename(finalPath), // Store actual filename on disk
					modName: modName,
					enabled: false, // Disable new mods by default to avoid conflicts
					path: finalPath,
					installedDate: new Date().toISOString()
				});
			} catch (err) {
				errors.push(`${fileName}: ${err.message}`);
			}
		}

		store.set('mods', currentMods);
		if (errors.length > 0) {
			return { mods: currentMods, errors };
		}
		return currentMods;
	});

	ipcMain.handle('mods:get', () => {
		const mods = store.get('mods', []);
		// Add installation date for existing mods that don't have it
		const updatedMods = mods.map(mod => {
			if (!mod.installedDate) {
				return { ...mod, installedDate: new Date().toISOString() };
			}
			return mod;
		});
		
		// Save the updated mods if any changes were made
		if (updatedMods.some((mod, index) => !mods[index].installedDate)) {
			store.set('mods', updatedMods);
		}
		
		return updatedMods;
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
					fs.unlinkSync(modToDelete.path);
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

	// ----- '套用 Mod' 邏輯修改 -----
	ipcMain.handle('mods:apply', async (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const mods = store.get('mods', []).filter(m => m.enabled);

		if (!store.get('gamePath')) {
			return { success: false, message: i18next.t('game_path_not_configured') };
		}

		const res = await dialog.showMessageBox(win, {
			type: 'warning',
			buttons: [i18next.t('button_cancel'), i18next.t('button_apply')],
			defaultId: 1, 
			title: i18next.t('apply_mods_confirm_title'),
			message: i18next.t('apply_mods_confirm_message'),
			cancelId: 0,
		});

		if (res.response === 0) {
			return { success: false, message: i18next.t('operation_cancelled') };
		}

		let operationsLog = [];

		for (const mod of mods) {
			// 步驟 1: 尋找原始遊戲檔案
			const targetFilePath = await findTargetFile(mod.fileName, win);
			if (!targetFilePath) {
				const logMsg = i18next.t('original_file_not_found', { file: mod.fileName });
				operationsLog.push(logMsg);
				safeWarn('Original file not found', mod.fileName);
				continue;
			}

			try {
				const modExtension = path.extname(mod.fileName).toLowerCase();
				const supportedForCrc = SUPPORTED_EXTENSIONS.includes(modExtension);

				// 備份原始檔案 (如果還沒有備份)
				const backupPath = `${targetFilePath}.bak`;
				if (!fs.existsSync(backupPath)) {
					fs.copyFileSync(targetFilePath, backupPath);
					console.log(`Backup created: ${path.basename(targetFilePath)}.bak`);
				}

				if (supportedForCrc && crcPatcher) {
					win.webContents.send('update-action-status', i18next.t('status_crc_patching', { file: mod.fileName }));
					// CRC 修補器會先修補 mod 檔案，然後我們需要將修補後的檔案覆蓋到目標位置
					await crcPatcher.manipulate_crc(targetFilePath, mod.path);
					// 將修補後的 mod 檔案覆蓋到遊戲目錄
					fs.copyFileSync(mod.path, targetFilePath);
					console.log(`CRC patched and applied: ${mod.fileName}`);
				} else {
					win.webContents.send('update-action-status', i18next.t('status_copying_file', { file: mod.fileName }));
					fs.copyFileSync(mod.path, targetFilePath);
					console.log(`Copied ${mod.fileName} to ${targetFilePath}`);
				}
			} catch (err) {
				console.error(`Error applying mod ${mod.fileName}:`, err);
				win.webContents.send('update-action-status', i18next.t('error_applying_mod', { file: mod.fileName, error: err.message }));
				operationsLog.push(i18next.t('error_applying_mod', { file: mod.fileName, error: err.message }));
				continue;
			}

			operationsLog.push(i18next.t('apply_success_log', { file: mod.fileName, path: path.dirname(targetFilePath) }));
		}
		safeLog('Apply operations completed. Total operations', operationsLog.length);
		return { success: true, message: i18next.t('operation_success'), log: operationsLog };
	});

	
	ipcMain.handle('mods:uninstall', async (event, selectedModIds) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!store.get('gamePath')) {
			return { success: false, message: i18next.t('game_path_not_configured') };
		}

		// If no specific mods selected, show error
		if (!selectedModIds || selectedModIds.length === 0) {
			return { success: false, message: i18next.t('no_mods_selected_for_uninstall') };
		}

		const res = await dialog.showMessageBox(win, {
			type: 'warning',
			buttons: [i18next.t('button_cancel'), i18next.t('button_apply')],
			defaultId: 1, 
			title: i18next.t('uninstall_mods_confirm_title'),
			message: i18next.t('uninstall_mods_confirm_message_selected'),
			cancelId: 0,
		});

		if (res.response === 0) {
			return { success: false, message: i18next.t('operation_cancelled') };
		}

		// Get only the selected mods for uninstall
		const allMods = store.get('mods', []);
		const modsToUninstall = allMods.filter(mod => selectedModIds.includes(mod.id));
		let operationsLog = [];

		for (const mod of modsToUninstall) {
			const targetPath = await findTargetFile(mod.fileName, win);
			if (!targetPath) {
				const logMsg = i18next.t('original_file_not_found', { file: mod.fileName });
				operationsLog.push(logMsg);
				safeWarn('Target file not found for mod', mod.fileName);
				continue;
			}

			const backupPath = `${targetPath}.bak`;
			try {
				if (fs.existsSync(backupPath)) {
					// 還原備份檔案
					fs.copyFileSync(backupPath, targetPath);
					console.log(`Successfully restored original file: ${path.basename(targetPath)}`);
					operationsLog.push(i18next.t('uninstall_restore_log', { file: path.basename(targetPath) }));
				} else {
					// 如果沒有備份檔案，記錄警告但繼續處理
					console.log(`No backup found for: ${path.basename(targetPath)}, skipping restore`);
					operationsLog.push(`No backup found for: ${mod.fileName}`);
				}
			} catch (err) {
				console.error(`Failed to uninstall mod ${mod.fileName}:`, err);
				operationsLog.push(`Error uninstalling ${mod.fileName}: ${err.message}`);
				return { success: false, message: i18next.t('operation_failed'), log: operationsLog };
			}
		}

		// Remove uninstalled mods from store
		const remainingMods = allMods.filter(mod => !selectedModIds.includes(mod.id));
		store.set('mods', remainingMods);

		safeLog('Uninstall operations completed. Total operations', operationsLog.length);
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