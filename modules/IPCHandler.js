const { ipcMain, dialog, shell, BrowserWindow } = require('electron');

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
    }
}

module.exports = IPCHandler;