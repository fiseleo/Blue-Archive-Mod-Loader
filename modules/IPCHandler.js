const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const path = require('path');
const PythonManager = require('./PythonManager');

/**
 * IPC 處理模塊
 * 負責處理所有主進程和渲染進程之間的通信
 */
class IPCHandler {
    constructor(store, app, i18next, gamePathManager, modManager, studentIndexManager) {
        this.store = store;
        this.app = app;
        this.i18next = i18next;
        this.gamePathManager = gamePathManager;
        this.modManager = modManager;
        this.studentIndexManager = studentIndexManager;
        this.bamtWindow = null;
    const rootDir = path.join(__dirname, '..');
    const appDataDir = path.join(app.getPath('appData'), 'blue-archive-mod-loader');
    this.pythonManager = new PythonManager(rootDir, { appDataDir });
        
        this.registerHandlers();
    }

    /**
     * 註冊所有 IPC 處理程序
     */
    registerHandlers() {
        // 遊戲啟動
        ipcMain.handle('game:launch', async () => {
            const steamUrl = 'steam://run/3557620';
            await shell.openExternal(steamUrl);
            return true;
        });

        // 檔案選擇對話框
        ipcMain.handle('dialog:openFile', async () => {
            return await this.modManager.selectModFiles(this.studentIndexManager);
        });

        // 獲取所有 Mod
        ipcMain.handle('mods:get', () => {
            return this.modManager.getAllMods(this.studentIndexManager);
        });

        // 更新 Mod
        ipcMain.handle('mods:update', (_event, updatedMod) => {
            return this.modManager.updateMod(updatedMod);
        });

        // 刪除 Mod
        ipcMain.handle('mods:delete', (_event, modId) => {
            return this.modManager.deleteMod(modId);
        });

        // 選擇遊戲路徑
        ipcMain.handle('dialog:selectGamePath', async (event) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
                title: this.i18next.t('select_game_executable'),
                properties: ['openFile'],
                filters: [{ name: 'BlueArchive Executable', extensions: ['exe'] }]
            });
            if (!canceled) {
                return this.gamePathManager.saveGamePaths(filePaths[0]);
            }
        });

        // 獲取遊戲配置
        ipcMain.handle('config:getGamePath', () => {
            return {
                gamePath: this.store.get('gamePath'),
                gameBundlePath: this.store.get('gameBundlePath'),
            };
        });

        ipcMain.handle('config:getDefaultOutputDir', () => {
            return this.modManager.getModBundleDir();
        });

        ipcMain.handle('env:checkPython', async () => {
            if (!this.pythonManager) {
                const root = path.join(__dirname, '..');
                const appData = path.join(this.app.getPath('appData'), 'blue-archive-mod-loader');
                this.pythonManager = new PythonManager(root, { appDataDir: appData });
            }
            return await this.pythonManager.ensureEnvironment();
        });

        // 獲取語言設定
        ipcMain.handle('i18n:getLocale', () => this.app.getLocale());

        // 應用 Mod
        ipcMain.handle('mods:apply', async (event, selectedModIds) => {
            const win = BrowserWindow.getFocusedWindow();
            return await this.modManager.applyMods(selectedModIds, this.gamePathManager, win);
        });

        // 卸載 Mod
        ipcMain.handle('mods:uninstall', async (event, selectedModIds) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            return await this.modManager.uninstallMods(selectedModIds, this.gamePathManager, win);
        });

        // 打開 BAMT 視窗
        ipcMain.handle('bamt:open', async () => {
            return await this.openBAMTWindow();
        });

        ipcMain.handle('bamt:runModUpdate', async (event, payload) => {
            const logs = [];
            const forwardLog = (entry) => {
                logs.push(entry);
                if (event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('bamt:cli-log', entry);
                }
            };
            try {
                const args = this.buildModUpdateArgs(payload);
                const result = await this.pythonManager.runCli('mod-update', args, forwardLog);
                return { ok: true, result };
            } catch (error) {
                forwardLog({ level: 'error', message: error.message || String(error) });
                return { ok: false, error: error.message || String(error), logs };
            }
        });

        ipcMain.handle('bamt:runPngReplace', async (event, payload) => {
            const logs = [];
            const forwardLog = (entry) => {
                logs.push(entry);
                if (event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('bamt:cli-log', entry);
                }
            };
            try {
                const args = this.buildPngReplaceArgs(payload);
                const result = await this.pythonManager.runCli('png-replace', args, forwardLog);
                return { ok: true, result };
            } catch (error) {
                forwardLog({ level: 'error', message: error.message || String(error) });
                return { ok: false, error: error.message || String(error), logs };
            }
        });

        ipcMain.handle('mods:triggerRefresh', () => {
            BrowserWindow.getAllWindows()
                .filter(win => !win.isDestroyed())
                .forEach(win => {
                    win.webContents.send('mods:refresh');
                });
            return true;
        });
    }

    /**
     * 創建並打開 BAMT 視窗
     */
    async openBAMTWindow() {
        try {
            // 若視窗已存在則直接聚焦
            if (this.bamtWindow && !this.bamtWindow.isDestroyed()) {
                if (this.bamtWindow.isMinimized()) {
                    this.bamtWindow.restore();
                }
                this.bamtWindow.focus();
                this.bamtWindow.show();
                return true;
            }

            // 創建新的 BAMT 視窗
            this.bamtWindow = new BrowserWindow({
                width: 1000,
                height: 700,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                },
                title: 'BA-Modding-Toolkit (BAMT)',
                icon: path.join(__dirname, '..', 'image.png'), // 使用主應用的圖標
                show: false // 先隱藏，載入完成後再顯示
            });

            // 載入 BAMT 的 HTML 頁面
            const bamtHtmlPath = path.join(__dirname, '..', 'BAMT', 'bamt.html');
            await this.bamtWindow.loadFile(bamtHtmlPath);

            // 設置菜單為 null（移除默認菜單）
            this.bamtWindow.setMenu(null);

            // 視窗載入完成後顯示
            this.bamtWindow.once('ready-to-show', () => {
                this.bamtWindow.center();
                this.bamtWindow.show();
                this.bamtWindow.focus();
            });

            // 處理視窗關閉事件
            this.bamtWindow.on('closed', () => {
                console.log('BAMT window closed');
                this.bamtWindow = null;
            });

            console.log('BAMT window opened successfully');
            return true;
        } catch (error) {
            console.error('Failed to open BAMT window:', error);
            this.bamtWindow = null;
            throw error;
        }
    }

    buildModUpdateArgs(payload = {}) {
        if (!payload.oldMod || !payload.newBundle || !payload.outputDir) {
            throw new Error('缺少必要參數：舊版 Mod、目標資源或輸出資料夾。');
        }
        const args = [
            '--old-mod', payload.oldMod,
            '--new-bundle', payload.newBundle,
            '--output-dir', payload.outputDir,
        ];
        if (payload.outputName) {
            args.push('--output-name', payload.outputName);
        }
        if (payload.enablePadding) {
            args.push('--enable-padding');
        }
        if (payload.createBackup) {
            args.push('--create-backup');
        }
        if (payload.replaceTexture) {
            args.push('--replace-texture');
        }
        if (payload.replaceTextasset) {
            args.push('--replace-textasset');
        }
        if (payload.replaceMesh) {
            args.push('--replace-mesh');
        }
        return args;
    }

    buildPngReplaceArgs(payload = {}) {
        if (!payload.bundle || !payload.pngFolder || !payload.outputDir) {
            throw new Error('缺少必要參數：目標 bundle、PNG 資料夾或輸出資料夾。');
        }
        const args = [
            '--bundle', payload.bundle,
            '--png-folder', payload.pngFolder,
            '--output-dir', payload.outputDir,
        ];
        if (payload.enablePadding) {
            args.push('--enable-padding');
        }
        return args;
    }
}

module.exports = IPCHandler;