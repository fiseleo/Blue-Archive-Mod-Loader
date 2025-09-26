// renderer.js

async function initializeI18n() {
    const userLocale = await window.i18n.getLocale();

    await i18next.init({
        lng: userLocale, 
        fallbackLng: 'en', 
        resources: {
            en: {
                translation: await fetch('./locales/en/translation.json').then(res => res.json())
            },
            'zh-TW': {
                translation: await fetch('./locales/zh-TW/translation.json').then(res => res.json())
            }
        }
    });
    updateContent();
}


function updateContent() {
    document.title = i18next.t('title');
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.innerHTML = i18next.t(key);
    });
}

function updateGamePathDisplay(paths) {
    const gamePathElement = document.getElementById('game-path');
    const gameBundlePathElement = document.getElementById('game-bundle-path');

    if (paths && paths.gamePath) {
        gamePathElement.innerText = paths.gamePath;
        gameBundlePathElement.innerText = paths.gameBundlePath || i18next.t('path_not_generated');
    } else {
        gamePathElement.innerText = i18next.t('game_path_not_set');
        gameBundlePathElement.innerText = '---';
    }
}


function setupEventListeners() {
    const selectModBtn = document.getElementById('select-file-btn');
    const setGamePathBtn = document.getElementById('set-game-path-btn');
    const statusMessageElement = document.getElementById('status-message');
    const applyBtn = document.getElementById('apply-mods-btn');
    const uninstallBtn = document.getElementById('uninstall-mods-btn');
    const launchGameBtn = document.getElementById('launch-game-btn');
    const actionStatusElement = document.getElementById('action-status');

    applyBtn.addEventListener('click', async () => {
        actionStatusElement.innerText = i18next.t('action_status_applying');
        const result = await window.api.applyMods();
        actionStatusElement.innerText = result.message; // 顯示最終結果
        // 5秒後清除訊息
        setTimeout(() => { actionStatusElement.innerText = ''; }, 5000);
    });
    selectModBtn.addEventListener('click', async () => {
        const mods = await window.api.selectModFiles();
        if (mods) renderModTable(mods);
    });

    setGamePathBtn.addEventListener('click', async () => {
        const paths = await window.api.selectGamePath();
        if (paths) updateGamePathDisplay(paths);
    });

    uninstallBtn.addEventListener('click', async () => {
        actionStatusElement.innerText = i18next.t('action_status_uninstalling');
        const result = await window.api.uninstallMods();
        actionStatusElement.innerText = result.message; // 顯示最終結果
        setTimeout(() => { actionStatusElement.innerText = ''; }, 5000);
    });

    launchGameBtn.addEventListener('click', async () => {
        actionStatusElement.innerText = i18next.t('action_status_launching');
        await window.api.launchGame();
        setTimeout(() => { actionStatusElement.innerText = ''; }, 3000);
    });

    window.api.onUpdateGamePath((paths) => {
        updateGamePathDisplay(paths);
        statusMessageElement.innerText = '';
    });

    window.api.onUpdateStatus((message) => {
        statusMessageElement.innerText = message;
    });
    
    // ❗️ 新增：監聽並顯示即時操作狀態
    window.api.onUpdateActionStatus((message) => {
        actionStatusElement.innerText = message;
    });
}

function renderModTable(mods) {
    const tableBody = document.getElementById('mod-table-body');
    tableBody.innerHTML = ''; // 清空舊的內容

    if (!mods || mods.length === 0) {
        const row = tableBody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 4;
        cell.textContent = i18next.t('no_mods_installed');
        cell.style.textAlign = 'center';
        return;
    }

    mods.forEach(mod => {
        const row = tableBody.insertRow();

        // Checkbox
        const enabledCell = row.insertCell();
        const enabledCheckbox = document.createElement('input');
        enabledCheckbox.type = 'checkbox';
        enabledCheckbox.checked = mod.enabled;
        enabledCheckbox.addEventListener('change', () => {
            window.api.updateMod({ id: mod.id, enabled: enabledCheckbox.checked });
        });
        enabledCell.appendChild(enabledCheckbox);

        // 檔名
        const fileNameCell = row.insertCell();
        fileNameCell.textContent = mod.fileName;

        // Mod 名稱 (可編輯)
        const modNameCell = row.insertCell();
        const modNameInput = document.createElement('input');
        modNameInput.type = 'text';
        modNameInput.value = mod.modName;
        modNameInput.className = 'mod-name-input';
        modNameInput.addEventListener('change', () => {
            window.api.updateMod({ id: mod.id, modName: modNameInput.value });
        });
        modNameCell.appendChild(modNameInput);

        // 刪除按鈕
        const actionsCell = row.insertCell();
        const deleteBtn = document.createElement('span');
        deleteBtn.textContent = '🗑️';
        deleteBtn.className = 'delete-btn';
        deleteBtn.title = i18next.t('delete_mod');
        deleteBtn.addEventListener('click', async () => {
            const updatedMods = await window.api.deleteMod(mod.id);
            renderModTable(updatedMods);
        });
        actionsCell.appendChild(deleteBtn);
    });
}


document.addEventListener('DOMContentLoaded', async () => {
    await initializeI18n();
    setupEventListeners();

    const initialPaths = await window.config.getGamePath();
    updateGamePathDisplay(initialPaths);

    const initialMods = await window.api.getMods();
    renderModTable(initialMods);
});