const path = require('path');
const fs = require('fs');
const fg = require('fast-glob');
const drivelist = require('drivelist');
const { exec } = require('child_process');

/**
 * 遊戲路徑檢測模塊
 * 負責自動檢測和管理 Blue Archive 遊戲路徑
 */
class GamePathManager {
    constructor(store, i18next) {
        this.store = store;
        this.i18next = i18next;
    }

    /**
     * 從 Steam 註冊檔獲取 Steam 安裝路徑
     */
    async getSteamInstallPath() {
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

    /**
     * 通過 Steam 查找遊戲
     */
    async findGameViaSteam(win) {
        win.webContents.send('update-status', this.i18next.t('status_finding_steam'));
        const steamPath = await this.getSteamInstallPath();
        if (!steamPath) {
            console.log('在登錄檔中找不到 Steam 安裝路徑。');
            return null;
        }

        win.webContents.send('update-status', this.i18next.t('status_steam_found', { path: steamPath }));
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
                win.webContents.send('update-status', this.i18next.t('status_checking_steam_library', { library: libPath }));

                if (fs.existsSync(manifestPath)) {
                    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
                    const installDirMatch = manifestContent.match(/"installdir"\s+"([^"]+)"/);
                    if (installDirMatch && installDirMatch[1]) {
                        const installDir = installDirMatch[1];
                        const gameExePath = path.join(libPath, 'steamapps', 'common', installDir, 'BlueArchive.exe');
                        if (fs.existsSync(gameExePath)) {
                            win.webContents.send('update-status', this.i18next.t('status_found_steam', { path: gameExePath }));
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

    /**
     * 獲取系統磁碟機列表
     */
    async getDriveLetters() {
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

    /**
     * 查找遊戲執行檔
     */
    async findGameExecutable(win) {
        try {
            const steamGamePath = await this.findGameViaSteam(win);
            if (steamGamePath) {
                this.saveGamePaths(steamGamePath);
                win.webContents.send('update-status', this.i18next.t('status_found', { path: steamGamePath }));
                return { gamePath: this.store.get('gamePath'), gameBundlePath: this.store.get('gameBundlePath') };
            }
            win.webContents.send('update-status', this.i18next.t('status_steam_not_found_fallback'));
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
            console.error('Steam 搜尋過程中發生錯誤:', err);
        }

        win.webContents.send('update-status', this.i18next.t('status_preparing_search'));
        const searchPaths = await this.getDriveLetters();
        win.webContents.send('update-status', this.i18next.t('status_drives_found', { drives: searchPaths.join(', ') }));

        await new Promise(resolve => setTimeout(resolve, 1000));

        for (const searchPath of searchPaths) {
            try {
                win.webContents.send('update-status', this.i18next.t('status_scanning_drive', { drive: searchPath }));

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
                    this.saveGamePaths(foundPath);
                    win.webContents.send('update-status', this.i18next.t('status_found', { path: foundPath }));
                    return { gamePath: this.store.get('gamePath'), gameBundlePath: this.store.get('gameBundlePath') };
                }
            } catch (err) {
                console.error(`Error searching in ${searchPath}:`, err);
            }
        }

        win.webContents.send('update-status', this.i18next.t('status_not_found'));
        return null;
    }

    /**
     * 保存遊戲路徑到設定中
     */
    saveGamePaths(executablePath) {
        const gameDirectory = path.dirname(executablePath);
        const bundlePath = path.join(gameDirectory, 'BlueArchive_Data');
        this.store.set({ gamePath: executablePath, gameBundlePath: bundlePath });
        return { gamePath: executablePath, gameBundlePath: bundlePath };
    }

    /**
     * 遞迴搜尋檔案
     */
    async findFileRecursively(directory, fileNameToFind) {
        try {
            const items = await fs.promises.readdir(directory, { withFileTypes: true });
            for (const item of items) {
                const fullPath = path.join(directory, item.name);
                if (item.isDirectory()) {
                    const result = await this.findFileRecursively(fullPath, fileNameToFind);
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

    /**
     * 查找目標檔案
     */
    async findTargetFile(modFileName, win) {
        const gamePath = this.store.get('gamePath');
        if (!gamePath) {
            console.warn('Game path not set in store.');
            return null;
        }

        const searchBase = path.join(path.dirname(gamePath), 'BlueArchive_Data');
        if (!fs.existsSync(searchBase)) {
            console.warn(`Search base directory does not exist: ${searchBase}`);
            return null;
        }

        win.webContents.send('update-action-status', this.i18next.t('status_searching_for_file', { file: modFileName }));
        console.log(`Searching for file: ${modFileName} in base directory: ${searchBase}`);

        const foundPath = await this.findFileRecursively(searchBase, modFileName);

        if (foundPath) {
            console.log(`File found: ${foundPath}`);
            return foundPath;
        }

        console.warn(`File not found: ${modFileName} in directory: ${searchBase}`);
        return null;
    }
}

module.exports = GamePathManager;