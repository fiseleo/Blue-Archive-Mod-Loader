// renderer.js

// 渲染器端的 i18next 初始化
async function initializeI18n() {
  const userLocale = await window.i18n.getLocale();
  await i18next.init({
    lng: userLocale,
    fallbackLng: 'en',
    resources: {
      en: { translation: await fetch('./locales/en/translation.json').then(res => res.json()) },
      'zh-TW': { translation: await fetch('./locales/zh-TW/translation.json').then(res => res.json()) }
    }
  });
  updateContent();
}

// 更新頁面上所有帶有 data-i18n 屬性的文字
function updateContent() {
  document.title = i18next.t('title');
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.innerHTML = i18next.t(key);
  });
}

// 更新遊戲路徑的顯示
function updateGamePathDisplay(path) {
    const gamePathElement = document.getElementById('game-path');
    if (path) {
        gamePathElement.innerText = path;
    } else {
        gamePathElement.innerText = i18next.t('game_path_not_set');
    }
}

// 綁定所有事件監聽器
function setupEventListeners() {
    const selectBundleBtn = document.getElementById('select-file-btn');
    const bundlePathElement = document.getElementById('file-path');
    const setGamePathBtn = document.getElementById('set-game-path-btn');

    // 選擇 .bundle 檔案的按鈕
    selectBundleBtn.addEventListener('click', async () => {
        const filePath = await window.api.openFile();
        if (filePath) {
            bundlePathElement.innerText = filePath;
        } else {
            bundlePathElement.innerText = i18next.t('user_cancelled');
        }
    });

    // 設定遊戲路徑的按鈕
    setGamePathBtn.addEventListener('click', async () => {
        const newPath = await window.api.selectGamePath();
        updateGamePathDisplay(newPath);
    });

    // 監聽來自 main.js 的路徑更新通知
    window.api.onUpdateGamePath((path) => {
        updateGamePathDisplay(path);
    });
}

// 主執行流程
document.addEventListener('DOMContentLoaded', async () => {
  await initializeI18n();
  setupEventListeners();
  
  // 頁面載入後，立即從設定檔讀取並顯示遊戲路徑
  const initialGamePath = await window.config.getGamePath();
  updateGamePathDisplay(initialGamePath);
});