const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store').default;
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const fg = require('fast-glob');

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


function getDriveLetters() {
  try {
    // 使用 Windows 的 wmic 指令來取得磁碟機列表
    const stdout = execSync('wmic logicaldisk get name', { encoding: 'utf8' });
    const drives = stdout.split('\n')
      .map(line => line.trim())
      .filter(line => /^[A-Z]:$/.test(line)) // 只保留像 "C:" 這樣的格式
      .map(drive => `${drive}/`); // 加上斜線，方便後續使用
    return drives;
  } catch (error) {
    console.error('Failed to get drive letters:', error);
    // 如果失敗，回傳一個預設的列表
    return ['C:/', 'D:/', 'E:/'];
  }
}

async function findGameExecutable(win) {
  win.webContents.send('update-status', i18next.t('status_preparing_search'));

  const searchPaths = getDriveLetters(); // 動態取得所有磁碟機
  win.webContents.send('update-status', i18next.t('status_drives_found', { drives: searchPaths.join(', ') }));
  
  await new Promise(resolve => setTimeout(resolve, 1000)); // 暫停一下讓使用者看到訊息

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
        win.webContents.send('update-status', i18next.t('status_found', { path: foundPath }));
        return foundPath;
      }
    } catch (err) {
      // 雖然 suppressErrors 已經設為 true，但仍保留以防萬一
      console.error(`Error searching in ${searchPath}:`, err);
    }
  }

  win.webContents.send('update-status', i18next.t('status_not_found'));
  return null;
}



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

	// 應用程式啟動後的完整檢查流程
	win.webContents.on('did-finish-load', async () => {
		let gamePath = store.get('gamePath');

		// 1. 檢查儲存的路徑是否仍然有效
		if (gamePath && fs.existsSync(gamePath)) {
			win.webContents.send('update-game-path', gamePath);
			return; // 路徑有效，流程結束
		}

		// 2. 如果路徑無效或不存在，開始自動搜尋
		gamePath = await findGameExecutable(win);

		if (gamePath) {
			// 3. 自動搜尋成功
			store.set('gamePath', gamePath);
			win.webContents.send('update-game-path', gamePath);
		} else {
			// 4. 自動搜尋失敗，彈出視窗讓使用者手動選擇
			const manualPath = await selectGamePath(win);
			if (manualPath) {
				win.webContents.send('update-game-path', manualPath);
			}
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