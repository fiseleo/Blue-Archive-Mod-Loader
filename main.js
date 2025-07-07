const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 載入 index.html
  win.loadFile('index.html');
  win.setMenu(null); // 隱藏預設的菜單欄
};

async function handleFileOpen() {
  const { canceled, filePaths} = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Bundle Files', extensions: ['bundle'] },
    ]
  });
  if (!canceled) {
    return filePaths[0]; // 返回選擇的文件路徑
  }
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:openFile', handleFileOpen);
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