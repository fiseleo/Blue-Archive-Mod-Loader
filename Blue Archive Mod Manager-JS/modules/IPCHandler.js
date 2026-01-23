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
                const lang = payload?.lang || (this.i18next ? this.i18next.language : null) || 'en';
                const result = await this.pythonManager.runCli('update', args, forwardLog, { lang });
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
                const lang = payload?.lang || (this.i18next ? this.i18next.language : null) || 'en';
                const result = await this.pythonManager.runCli('replace-png', args, forwardLog, { lang });
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

        ipcMain.handle('bamt:replaceOriginal', async (event, payload) => {
            return await this.handleReplaceOriginal(payload);
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
        
        // 根據選項構建 asset-types 列表
        const assetTypes = [];
        if (payload.replaceTexture) {
            assetTypes.push('Texture2D');
        }
        if (payload.replaceTextasset) {
            assetTypes.push('TextAsset');
        }
        if (payload.replaceMesh) {
            assetTypes.push('Mesh');
        }
        
        // 如果沒有選擇任何資源類型，默認使用 Texture2D
        if (assetTypes.length === 0) {
            assetTypes.push('Texture2D');
        }
        
        args.push('--asset-types', ...assetTypes);
        
        return args;
    }

    buildPngReplaceArgs(payload = {}) {
        if (!payload.bundle || !payload.pngFolder || !payload.outputDir) {
            throw new Error('缺少必要參數：目標 bundle、PNG 資料夾或輸出資料夾。');
        }
        const args = [
            '--bundle', payload.bundle,
            '--image-folder', payload.pngFolder,
            '--output-dir', payload.outputDir,
        ];
        return args;
    }

    async handleReplaceOriginal(payload) {
        const fs = require('fs').promises;
        const fsSync = require('fs');
        const path = require('path');

        try {
            const { outputPath, originalPath, type } = payload;

            if (!outputPath || !originalPath) {
                throw new Error('缺少必要參數：輸出路徑或原始路徑。');
            }

            // 檢查文件是否存在
            if (!fsSync.existsSync(outputPath)) {
                throw new Error(`處理後的文件不存在: ${outputPath}`);
            }

            if (!fsSync.existsSync(originalPath)) {
                throw new Error(`原始文件不存在: ${originalPath}`);
            }

            // 確定輸出文件的實際路徑
            const outputDir = path.dirname(outputPath);
            const originalFileName = path.basename(originalPath);
            const actualOutputPath = path.join(outputDir, originalFileName);

            // 檢查處理後的文件是否存在
            let sourceFile = outputPath;
            if (!fsSync.existsSync(actualOutputPath)) {
                // 如果使用原始文件名的文件不存在，使用原本的輸出路徑
                sourceFile = outputPath;
            } else {
                sourceFile = actualOutputPath;
            }

            // 創建備份
            const backupPath = originalPath + '.bak';
            const backupExists = fsSync.existsSync(backupPath);
            
            if (!backupExists) {
                await fs.copyFile(originalPath, backupPath);
            }

            // 複製處理後的文件覆蓋原始文件
            await fs.copyFile(sourceFile, originalPath);

            return {
                ok: true,
                backupPath: backupExists ? '(已存在備份)' : backupPath,
                message: '原始文件已成功覆蓋'
            };

        } catch (error) {
            console.error('Replace original file error:', error);
            return {
                ok: false,
                error: error.message || String(error)
            };
        }
    }
}

module.exports = IPCHandler;