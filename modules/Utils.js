const { exec } = require('child_process');

/**
 * 實用工具模塊
 * 提供通用的實用函數和控制台編碼處理
 */
class Utils {
    /**
     * 設定 Windows 控制台編碼
     */
    static setupConsoleEncoding() {
        if (process.platform === 'win32') {
            // 設定 Node.js 輸出編碼
            if (process.stdout && process.stdout.setDefaultEncoding) {
                process.stdout.setDefaultEncoding('utf8');
            }
            if (process.stderr && process.stderr.setDefaultEncoding) {
                process.stderr.setDefaultEncoding('utf8');
            }

            // 設定 Windows 控制台字碼頁為 UTF-8
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
    }

    /**
     * 安全地記錄到控制台，避免編碼問題
     */
    static safeLog(message, data = '') {
        try {
            if (data) {
                console.log(`${message}:`, data);
            } else {
                console.log(message);
            }
        } catch (error) {
            // 編碼問題的退回處理
            console.log('Log output (encoding safe)');
        }
    }

    /**
     * 安全地記錄警告到控制台
     */
    static safeWarn(message, data = '') {
        try {
            if (data) {
                console.warn(`${message}:`, data);
            } else {
                console.warn(message);
            }
        } catch (error) {
            // 編碼問題的退回處理
            console.warn('Warning output (encoding safe)');
        }
    }

    /**
     * 安全地記錄錯誤到控制台
     */
    static safeError(message, error = null) {
        try {
            if (error) {
                console.error(`${message}:`, error);
            } else {
                console.error(message);
            }
        } catch (err) {
            // 編碼問題的退回處理
            console.error('Error output (encoding safe)');
        }
    }
}

module.exports = Utils;