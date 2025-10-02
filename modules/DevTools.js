const { globalShortcut } = require('electron');

/**
 * Conditionally registers the shortcut to toggle the DevTools.
 * @param {boolean} isDev - True if running in development mode.
 * @param {BrowserWindow} mainWindow - The reference to the main application window.
 */
function EnableDevTools(isPackaged, mainWindow)
{
    if(isPackaged) return;

    const devToolsRet = globalShortcut.register('CommandOrControl+Shift+I', () => {
        if (!mainWindow) return; 
        if (mainWindow.webContents.isDevToolsOpened()) {
            mainWindow.webContents.closeDevTools();
        } else {
            mainWindow.webContents.openDevTools();
        }
    });

    if (!devToolsRet) {
        console.log('Global shortcut registration failed.');
    } else {
        console.log('Environment check shortcut registered successfully.');
    }
}

function DisableDevTools()
{
    globalShortcut.unregisterAll();
}

module.exports = {
    EnableDevTools, DisableDevTools
};