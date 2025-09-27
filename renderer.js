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

// Check for conflicting mods (same filename)
function detectConflictingMods(mods) {
    const conflicts = {};
    mods.forEach(mod => {
        if (!conflicts[mod.fileName]) {
            conflicts[mod.fileName] = [];
        }
        conflicts[mod.fileName].push(mod);
    });
    return conflicts;
}

// Select all mods with intelligent conflict resolution
function selectAllMods() {
    const tableBody = document.getElementById('mod-table-body');
    const checkboxes = tableBody.querySelectorAll('input[type="checkbox"]');
    const mods = Array.from(checkboxes).map(cb => ({
        id: cb.dataset.modId,
        fileName: cb.dataset.fileName,
        installedDate: cb.dataset.installedDate
    }));

    const conflicts = detectConflictingMods(mods);
    
    // Uncheck all first
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });

    // For each filename, select only the latest or first one
    Object.values(conflicts).forEach(modVersions => {
        if (modVersions.length === 1) {
            // Single version, select it
            const checkbox = tableBody.querySelector(`input[data-mod-id="${modVersions[0].id}"]`);
            if (checkbox) checkbox.checked = true;
        } else {
            // Multiple versions, select the latest installed or first one
            const latestMod = modVersions.reduce((latest, current) => {
                if (!latest.installedDate || !current.installedDate) {
                    return latest; // If no install date, keep first
                }
                return new Date(current.installedDate) > new Date(latest.installedDate) ? current : latest;
            }, modVersions[0]);
            
            const checkbox = tableBody.querySelector(`input[data-mod-id="${latestMod.id}"]`);
            if (checkbox) checkbox.checked = true;
        }
    });
}


function setupEventListeners() {
    const selectModBtn = document.getElementById('select-file-btn');
    const selectAllBtn = document.getElementById('select-all-btn');
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

    selectAllBtn.addEventListener('click', () => {
        selectAllMods();
    });

    setGamePathBtn.addEventListener('click', async () => {
        const paths = await window.api.selectGamePath();
        if (paths) updateGamePathDisplay(paths);
    });

    uninstallBtn.addEventListener('click', async () => {
        const tableBody = document.getElementById('mod-table-body');
        const selectedCheckboxes = tableBody.querySelectorAll('input[type="checkbox"]:checked');
        
        if (selectedCheckboxes.length === 0) {
            actionStatusElement.innerText = i18next.t('action_status_no_mods_selected');
            setTimeout(() => { actionStatusElement.innerText = ''; }, 3000);
            return;
        }

        const selectedModIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.modId);
        
        actionStatusElement.innerText = i18next.t('action_status_uninstalling');
        const result = await window.api.uninstallMods(selectedModIds);
        actionStatusElement.innerText = result.message; // 顯示最終結果
        
        // Refresh the mod table after uninstall
        const updatedMods = await window.api.getMods();
        renderModTable(updatedMods);
        
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

    // Detect conflicts
    const conflicts = detectConflictingMods(mods);
    const hasConflicts = Object.values(conflicts).some(versions => versions.length > 1);

    mods.forEach(mod => {
        const row = tableBody.insertRow();
        const isConflicted = conflicts[mod.fileName] && conflicts[mod.fileName].length > 1;

        // Checkbox
        const enabledCell = row.insertCell();
        const enabledCheckbox = document.createElement('input');
        enabledCheckbox.type = 'checkbox';
        enabledCheckbox.checked = mod.enabled;
        enabledCheckbox.dataset.modId = mod.id;
        enabledCheckbox.dataset.fileName = mod.fileName;
        enabledCheckbox.dataset.installedDate = mod.installedDate || '';
        
        // Add conflict detection
        enabledCheckbox.addEventListener('change', () => {
            if (enabledCheckbox.checked && isConflicted) {
                // Uncheck other versions of the same file
                const otherCheckboxes = Array.from(tableBody.querySelectorAll(`input[type="checkbox"]`))
                    .filter(cb => cb.dataset.fileName === mod.fileName && cb !== enabledCheckbox);
                otherCheckboxes.forEach(cb => {
                    cb.checked = false;
                    // Update the mod state
                    window.api.updateMod({ id: cb.dataset.modId, enabled: false });
                });
            }
            window.api.updateMod({ id: mod.id, enabled: enabledCheckbox.checked });
        });
        enabledCell.appendChild(enabledCheckbox);

        // 檔名 with conflict warning
        const fileNameCell = row.insertCell();
        fileNameCell.textContent = mod.fileName;
        if (isConflicted) {
            fileNameCell.style.color = '#ff6b6b';
            fileNameCell.title = i18next.t('conflicting_mod_warning', { filename: mod.fileName });
        }

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

    // Show conflict warning if exists
    if (hasConflicts) {
        const warningRow = tableBody.insertRow(0);
        const warningCell = warningRow.insertCell();
        warningCell.colSpan = 4;
        warningCell.innerHTML = '<strong style="color: #ff6b6b;">⚠️ ' + i18next.t('conflicting_mod_warning', { filename: '' }).replace(' {{filename}}', '') + '</strong>';
        warningCell.style.textAlign = 'center';
        warningCell.style.backgroundColor = '#fff3cd';
        warningCell.style.padding = '10px';
    }
}


document.addEventListener('DOMContentLoaded', async () => {
    await initializeI18n();
    setupEventListeners();

    const initialPaths = await window.config.getGamePath();
    updateGamePathDisplay(initialPaths);

    const initialMods = await window.api.getMods();
    renderModTable(initialMods);
});