const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { dialog } = require('electron');

/**
 * Mod 管理模塊
 * 負責 Mod 的安裝、卸載、應用和管理
 */
class ModManager {
    constructor(store, app, i18next) {
        this.store = store;
        this.app = app;
        this.i18next = i18next;
        this.modBundleDir = path.join(app.getPath('userData'), 'ModBundle');
        this.SUPPORTED_EXTENSIONS = [
            '.ogg', '.mp4', '.jpg', '.jpeg', '.png', '.bundle', '.zip', '.db'
        ];
        
        // 確保 ModBundle 目錄存在
        if (!fs.existsSync(this.modBundleDir)) {
            fs.mkdirSync(this.modBundleDir, { recursive: true });
        }

        // 嘗試載入 CRC Patcher
        try {
            this.crcPatcher = require('../crc-patcher.js');
            console.log('CRC Patcher module loaded successfully.');
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND') {
                console.warn('CRC Patcher module (crc_patcher.js) not found. Mods will be applied without CRC correction.');
                this.crcPatcher = {
                    manipulate_crc: async () => {
                        console.warn('CRC correction skipped because patcher module is missing.');
                        return true;
                    }
                };
            } else {
                throw e;
            }
        }
    }

    /**
     * 選擇並載入 Mod 檔案
     */
    async selectModFiles(studentIndexManager) {
        // 轉換支援的副檔名為過濾器格式（移除點）
        const supportedExts = this.SUPPORTED_EXTENSIONS.map(ext => ext.replace('.', ''));

        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: this.i18next.t('select_file_button'),
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Mod Files', extensions: supportedExts },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (canceled || filePaths.length === 0) {
            return null;
        }

        const currentMods = this.store.get('mods', []);
        const errors = [];

        if (!fs.existsSync(this.modBundleDir)) {
            try {
                fs.mkdirSync(this.modBundleDir, { recursive: true });
            } catch (err) {
                return { mods: currentMods, errors: [this.i18next.t('modbundle_create_failed') + ': ' + err.message] };
            }
        }

        for (const filePath of filePaths) {
            const fileName = path.basename(filePath);
            let modName = fileName.replace(/\.bundle$/i, '');
            let finalPath = path.join(this.modBundleDir, fileName);

            // 檢查是否已存在同檔名的 Mod
            const existingMod = currentMods.find(mod => mod.fileName === fileName);
            if (existingMod) {
                // 為這個版本產生唯一的檔名
                const fileExt = path.extname(fileName);
                const baseName = path.basename(fileName, fileExt);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const newFileName = `${baseName}_v${timestamp}${fileExt}`;
                finalPath = path.join(this.modBundleDir, newFileName);
                modName = `${modName} (v${timestamp.substring(0, 16)})`;

                console.log(`Duplicate mod detected: ${fileName}. Creating new version: ${newFileName}`);
            }

            if (!fs.existsSync(filePath)) {
                errors.push(`${fileName}: ${this.i18next.t('file_not_found')}`);
                continue;
            }

            try {
                fs.copyFileSync(filePath, finalPath);
                
                // 立即為新 Mod 提取角色資訊
                const currentLocale = this.store.get('language') || this.app.getLocale();
                const localeMap = { 'zh-TW': 'tw', 'zh-CN': 'cn', 'en': 'en' };
                const targetLocale = localeMap[currentLocale] || 'en';
                const characterInfo = studentIndexManager.extractCharacterInfo(fileName, targetLocale);
                
                const newMod = {
                    id: crypto.randomUUID(),
                    fileName: fileName, // 保持原始檔名用於衝突檢測
                    actualFileName: path.basename(finalPath), // 存儲磁碟上的實際檔名
                    modName: modName,
                    enabled: false, // 預設停用新 Mod 以避免衝突
                    path: finalPath,
                    installedDate: new Date().toISOString(),
                    character: characterInfo ? characterInfo.name : '',
                    characterId: characterInfo ? characterInfo.id : null,
                    characterDev: characterInfo ? characterInfo.devName : null,
                    lastLanguage: targetLocale
                };
                
                currentMods.push(newMod);
                console.log(`Added mod: ${fileName} -> Character: ${newMod.character || 'Unknown'}`);
            } catch (err) {
                errors.push(`${fileName}: ${err.message}`);
            }
        }

        this.store.set('mods', currentMods);
        if (errors.length > 0) {
            return { mods: currentMods, errors };
        }
        return currentMods;
    }

    /**
     * 獲取所有 Mod
     */
    getAllMods(studentIndexManager) {
        const mods = this.store.get('mods', []);
        const currentLocale = this.store.get('language') || this.app.getLocale();
        const localeMap = { 'zh-TW': 'tw', 'zh-CN': 'cn', 'en': 'en' };
        const targetLocale = localeMap[currentLocale] || 'en';
        const supportedExts = new Set(this.SUPPORTED_EXTENSIONS.map((ext) => ext.toLowerCase()));
        const resolveStoredPath = (mod) => {
            const directPath = mod.path;
            if (directPath) {
                return path.normalize(directPath);
            }
            const actual = mod.actualFileName;
            if (actual) {
                return path.normalize(path.join(this.modBundleDir, actual));
            }
            if (mod.fileName) {
                return path.normalize(path.join(this.modBundleDir, mod.fileName));
            }
            return null;
        };
        const knownPaths = new Set();
        mods.forEach((mod) => {
            try {
                const normalized = resolveStoredPath(mod);
                if (normalized) {
                    knownPaths.add(normalized);
                }
            } catch (error) {
                console.warn('Failed to normalize stored mod path:', error);
            }
        });
        let insertedNewFile = false;
        try {
            const entries = fs.readdirSync(this.modBundleDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile()) {
                    continue;
                }
                const ext = path.extname(entry.name).toLowerCase();
                if (!supportedExts.has(ext)) {
                    continue;
                }
                const absolutePath = path.join(this.modBundleDir, entry.name);
                let normalizedPath;
                try {
                    normalizedPath = path.normalize(absolutePath);
                } catch (error) {
                    console.warn('Failed to normalize discovered mod path:', error);
                    continue;
                }
                if (knownPaths.has(normalizedPath)) {
                    continue;
                }
                let installedDate;
                try {
                    const stats = fs.statSync(absolutePath);
                    installedDate = stats.mtime.toISOString();
                } catch (error) {
                    installedDate = new Date().toISOString();
                }
                const baseName = path.basename(entry.name, ext);
                const characterInfo = studentIndexManager.extractCharacterInfo(entry.name, targetLocale);
                mods.push({
                    id: crypto.randomUUID(),
                    fileName: entry.name,
                    actualFileName: entry.name,
                    modName: baseName,
                    enabled: false,
                    path: absolutePath,
                    installedDate,
                    character: characterInfo ? characterInfo.name : '',
                    characterId: characterInfo ? characterInfo.id : null,
                    characterDev: characterInfo ? characterInfo.devName : null,
                    lastLanguage: targetLocale,
                });
                knownPaths.add(normalizedPath);
                insertedNewFile = true;
            }
        } catch (error) {
            console.warn('Failed to scan ModBundle directory for new mods:', error);
        }
        
        // 為現有 Mod 添加安裝日期和角色資訊
        const updatedMods = mods.map(mod => {
            const updatedMod = { ...mod };
            
            // 如果缺少安裝日期，添加
            if (!updatedMod.installedDate) {
                updatedMod.installedDate = new Date().toISOString();
            }
            
            // 如果尚未提供角色資訊或語言已變更，添加角色資訊
            if (!updatedMod.character || updatedMod.lastLanguage !== targetLocale) {
                const characterInfo = studentIndexManager.extractCharacterInfo(mod.fileName, targetLocale);
                updatedMod.character = characterInfo ? characterInfo.name : '';
                updatedMod.characterId = characterInfo ? characterInfo.id : null;
                updatedMod.characterDev = characterInfo ? characterInfo.devName : null;
                updatedMod.lastLanguage = targetLocale;
            }
            
            return updatedMod;
        });

        // 如果有任何變更，保存更新的 Mod
        const requiresUpdate = insertedNewFile || updatedMods.some((mod, index) => 
            !mods[index].installedDate || 
            mods[index].lastLanguage !== targetLocale ||
            !mods[index].hasOwnProperty('character')
        );
        if (requiresUpdate) {
            this.store.set('mods', updatedMods);
        }

        return updatedMods;
    }

    /**
     * 更新 Mod
     */
    updateMod(updatedMod) {
        let mods = this.store.get('mods', []);
        const modIndex = mods.findIndex(mod => mod.id === updatedMod.id);
        if (modIndex !== -1) {
            mods[modIndex] = { ...mods[modIndex], ...updatedMod };
            this.store.set('mods', mods);
        }
        return mods;
    }

    /**
     * 刪除 Mod
     */
    deleteMod(modId) {
        let mods = this.store.get('mods', []);
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
        this.store.set('mods', newMods);
        return newMods;
    }

    /**
     * 應用選定的 Mod
     */
    async applyMods(selectedModIds, gamePathManager, win) {
        const allMods = this.store.get('mods', []);
        const operationsLog = [];

        if (!selectedModIds || selectedModIds.length === 0) {
            return { success: false, message: this.i18next.t('no_mods_selected_for_installation'), log: [] };
        }

        // 只處理選中的 Mod
        const modsToApply = allMods.filter(mod => selectedModIds.includes(mod.id));

        for (const mod of modsToApply) {
            win.webContents.send('update-action-status', this.i18next.t('status_applying_mod', { file: mod.fileName }));

            // 使用正確的檔案路徑（actualFileName 或 fileName）
            const modFileName = mod.actualFileName || mod.fileName;
            const modPath = path.join(this.modBundleDir, modFileName);
            
            if (!fs.existsSync(modPath)) {
                operationsLog.push(`Mod file not found at: ${modPath}`);
                continue;
            }

            const targetPath = await gamePathManager.findTargetFile(mod.fileName, win);
            if (!targetPath) {
                operationsLog.push(`Target file not found for mod: ${mod.fileName}`);
                continue;
            }

            try {
                const backupPath = `${targetPath}.bak`;
                
                // 如果備份不存在，創建備份（保存原始檔案）
                if (!fs.existsSync(backupPath)) {
                    fs.copyFileSync(targetPath, backupPath);
                    operationsLog.push(`Backup created for: ${path.basename(targetPath)}`);
                }

                // 直接使用 CRC Patcher 進行修補，而不是先複製檔案
                // manipulate_crc(original_path, mod_file_path, target_path)
                const success = await this.crcPatcher.manipulate_crc(backupPath, modPath, targetPath);
                
                if (success) {
                    operationsLog.push(`Successfully applied mod: ${mod.fileName}`);
                } else {
                    operationsLog.push(`Failed to apply CRC patch for: ${mod.fileName}`);
                }
            } catch (err) {
                console.error(`Failed to apply mod ${mod.fileName}:`, err);
                operationsLog.push(`Error applying ${mod.fileName}: ${err.message}`);
            }
        }

        return { success: true, message: this.i18next.t('operation_success'), log: operationsLog };
    }

    /**
     * 卸載選定的 Mod
     */
    async uninstallMods(selectedModIds, gamePathManager, win) {
        if (!this.store.get('gamePath')) {
            return { success: false, message: this.i18next.t('game_path_not_configured') };
        }

        // 如果沒有選定特定的 Mod，顯示錯誤
        if (!selectedModIds || selectedModIds.length === 0) {
            return { success: false, message: this.i18next.t('no_mods_selected_for_uninstall') };
        }

        const res = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: [this.i18next.t('button_cancel'), this.i18next.t('button_apply')],
            defaultId: 1,
            title: this.i18next.t('uninstall_mods_confirm_title'),
            message: this.i18next.t('uninstall_mods_confirm_message_selected'),
            cancelId: 0,
        });

        if (res.response === 0) {
            return { success: false, message: this.i18next.t('operation_cancelled') };
        }

        // 只獲取選定要卸載的 Mod
    const allMods = this.store.get('mods', []);
    const modsToUninstall = allMods.filter(mod => selectedModIds.includes(mod.id));
        let operationsLog = [];

        for (const mod of modsToUninstall) {
            const targetPath = await gamePathManager.findTargetFile(mod.fileName, win);
            if (!targetPath) {
                const logMsg = this.i18next.t('original_file_not_found', { file: mod.fileName });
                operationsLog.push(logMsg);
                console.warn('Target file not found for mod', mod.fileName);
                continue;
            }

            const backupPath = `${targetPath}.bak`;
            try {
                if (fs.existsSync(backupPath)) {
                    // 還原備份檔案
                    fs.copyFileSync(backupPath, targetPath);
                    console.log(`Successfully restored original file: ${path.basename(targetPath)}`);
                    operationsLog.push(this.i18next.t('uninstall_restore_log', { file: path.basename(targetPath) }));
                } else {
                    // 如果沒有備份檔案，記錄警告但繼續處理
                    console.log(`No backup found for: ${path.basename(targetPath)}, skipping restore`);
                    operationsLog.push(`No backup found for: ${mod.fileName}`);
                }
            } catch (err) {
                console.error(`Failed to uninstall mod ${mod.fileName}:`, err);
                operationsLog.push(`Error uninstalling ${mod.fileName}: ${err.message}`);
                return { success: false, message: this.i18next.t('operation_failed'), log: operationsLog };
            }
        }

        // 將已卸載的 Mod 標記為停用，避免仍顯示為勾選狀態
        const updatedMods = allMods.map((mod) => {
            if (selectedModIds.includes(mod.id)) {
                return { ...mod, enabled: false };
            }
            return mod;
        });
        this.store.set('mods', updatedMods);

        console.log('Uninstall operations completed. Total operations', operationsLog.length);
        return { success: true, message: this.i18next.t('operation_success'), log: operationsLog };
    }

    getModBundleDir() {
        return this.modBundleDir;
    }
}

module.exports = ModManager;