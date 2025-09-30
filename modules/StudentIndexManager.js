const path = require('path');
const fs = require('fs');
const { BrowserWindow } = require('electron');

/**
 * 學生索引管理模塊
 * 負責學生數據的載入、更新和角色資訊提取
 */
class StudentIndexManager {
    constructor(app) {
        this.app = app;
        this.appDataPath = path.join(app.getPath('userData'), 'student-index.json');
        this.studentIndex = {};
    }

    /**
     * 載入學生索引
     */
    loadStudentIndex() {
        try {
            if (fs.existsSync(this.appDataPath)) {
                this.studentIndex = JSON.parse(fs.readFileSync(this.appDataPath, 'utf8'));
                console.log('Student index loaded successfully from:', this.appDataPath);
                return true;
            } else {
                console.warn('Student index not found. Will create new index.');
                return false;
            }
        } catch (error) {
            console.error('Failed to load student index:', error);
            return false;
        }
    }

    /**
     * 更新學生索引
     */
    async updateStudentIndex() {
        let progressWin;
        let progressClosed = Promise.resolve();

        try {
            console.log('Updating student index...');

            // 創建進度視窗
            progressWin = new BrowserWindow({
                width: 400,
                height: 200,
                resizable: false,
                alwaysOnTop: true,
                frame: false,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            });

            progressClosed = new Promise(resolve => {
                progressWin.once('closed', resolve);
            });

            // 載入進度 HTML 檔案
            await progressWin.loadFile(path.join(__dirname, '..', 'progress.html'));

            const { createStudentIndex } = require('../create-index.js');

            // 進度回調函數
            const progressCallback = (status, percent) => {
                // 使用 executeJavaScript 並加上 try-catch 以避免錯誤
                progressWin.webContents.executeJavaScript(`
                    try {
                        if (typeof updateProgress === 'function') {
                            updateProgress('${status.replace(/'/g, "\\'")}', ${percent});
                        }
                    } catch (e) {
                        console.log('Progress update error:', e);
                    }
                `).catch(() => {
                    // 忽略視窗關閉後的錯誤
                });
            };

            const newIndex = await createStudentIndex(this.appDataPath, progressCallback);
            this.studentIndex = newIndex;

            // 短暫延遲後關閉進度視窗並等待其關閉
            setTimeout(() => {
                if (progressWin && !progressWin.isDestroyed()) {
                    progressWin.close();
                }
            }, 500);

            await progressClosed;

            console.log('Student index updated successfully.');
        } catch (error) {
            console.error('Failed to update student index:', error);
            if (progressWin && !progressWin.isDestroyed()) {
                progressWin.close();
            }
            // 退回到載入現有索引
            this.loadStudentIndex();
        } finally {
            if (progressWin && !progressWin.isDestroyed()) {
                progressWin.close();
            }
            try {
                await progressClosed;
            } catch (e) {
                // 忽略關閉競爭錯誤
            }
        }
    }

    /**
     * 從檔名提取角色資訊
     */
    extractCharacterInfo(filename, locale = 'en') {
        if (!filename) return null;
        
        // 在檔名中尋找角色模式（不區分大小寫）
        const lowerFilename = filename.toLowerCase();
        
        // 第一次搜尋：在 devName 中搜尋角色代碼（完全匹配如 CH0233, CH0068 等）
        for (const [devName, characterData] of Object.entries(this.studentIndex)) {
            if (lowerFilename.includes(devName)) {
                const name = characterData.names[locale] || characterData.names.en || devName;
                return {
                    devName: characterData.devName,
                    name: name,
                    id: characterData.id
                };
            }
        }
        
        // 第二次搜尋：在 names 欄位中搜尋角色名稱（所有語言）
        for (const [devName, characterData] of Object.entries(this.studentIndex)) {
            // 檢查名稱的所有語言版本
            const allNames = Object.values(characterData.names || {});
            for (const nameVariant of allNames) {
                if (nameVariant && lowerFilename.includes(nameVariant.toLowerCase())) {
                    const name = characterData.names[locale] || characterData.names.en || characterData.devName;
                    return {
                        devName: characterData.devName,
                        name: name,
                        id: characterData.id
                    };
                }
            }
        }
        
        return null;
    }

    /**
     * 獲取學生索引
     */
    getStudentIndex() {
        return this.studentIndex;
    }
}

module.exports = StudentIndexManager;