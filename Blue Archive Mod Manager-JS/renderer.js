// renderer.js

const i18next = window.i18next;

if (!i18next) {
    throw new Error('i18next global is unavailable. Ensure i18next.min.js is loaded before renderer.js.');
}

// 排序狀態
let sortState = {
    column: null,
    direction: 'asc' // 'asc' 或 'desc'
};

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
            },
            'zh-CN': {
                translation: await fetch('./locales/zh-CN/translation.json').then(res => res.json())
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

    // Update theme toggle button title
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        themeToggleBtn.title = i18next.t('toggle_theme');
    }
}

// Theme management functions
function getStoredTheme() {
    return localStorage.getItem('theme') || 'light';
}

function setStoredTheme(theme) {
    localStorage.setItem('theme', theme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeIcon = document.querySelector('.theme-icon');
    if (themeIcon) {
        themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
}

function toggleTheme() {
    const currentTheme = getStoredTheme();
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setStoredTheme(newTheme);
    applyTheme(newTheme);
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
// renderer.js

function selectAllMods() {
    const tableBody = document.getElementById('mod-table-body');
    const checkboxes = tableBody.querySelectorAll('input[type="checkbox"]');
    if (checkboxes.length === 0) return;

    // [Fix] 檢查是否所有 checkbox 都已被選中
    const allSelected = Array.from(checkboxes).every(cb => cb.checked);

    if (allSelected) {
        // 如果全部都選了，就全部取消
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
    } else {
        // 否則，執行原本的智慧選擇邏輯（處理衝突檔案）
        const mods = Array.from(checkboxes).map(cb => ({
            id: cb.dataset.modId,
            fileName: cb.dataset.fileName,
            installedDate: cb.dataset.installedDate
        }));

        const conflicts = detectConflictingMods(mods);

        // 先全部取消勾選
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });

        // 對於每個檔名，只選擇最新的一個
        Object.values(conflicts).forEach(modVersions => {
            if (modVersions.length === 1) {
                const checkbox = tableBody.querySelector(`input[data-mod-id="${modVersions[0].id}"]`);
                if (checkbox) checkbox.checked = true;
            } else {
                const latestMod = modVersions.reduce((latest, current) => {
                    if (!latest.installedDate || !current.installedDate) {
                        return latest;
                    }
                    return new Date(current.installedDate) > new Date(latest.installedDate) ? current : latest;
                }, modVersions[0]);
                
                const checkbox = tableBody.querySelector(`input[data-mod-id="${latestMod.id}"]`);
                if (checkbox) checkbox.checked = true;
            }
        });
    }
}

// 排序 mods 陣列
function sortMods(mods, column, direction) {
    const sortedMods = [...mods];
    
    sortedMods.sort((a, b) => {
        let valueA, valueB;
        
        switch (column) {
            case 'character':
                valueA = (a.character || '').toLowerCase();
                valueB = (b.character || '').toLowerCase();
                break;
            case 'fileName':
                valueA = a.fileName.toLowerCase();
                valueB = b.fileName.toLowerCase();
                break;
            case 'modName':
                valueA = a.modName.toLowerCase();
                valueB = b.modName.toLowerCase();
                break;
            case 'installedDate':
                valueA = new Date(a.installedDate || 0);
                valueB = new Date(b.installedDate || 0);
                break;
            default:
                return 0;
        }
        
        if (column === 'installedDate') {
            // 日期排序
            if (direction === 'asc') {
                return valueA - valueB;
            } else {
                return valueB - valueA;
            }
        } else {
            // 字符串排序
            if (valueA < valueB) {
                return direction === 'asc' ? -1 : 1;
            }
            if (valueA > valueB) {
                return direction === 'asc' ? 1 : -1;
            }
            return 0;
        }
    });
    
    return sortedMods;
}

// 設置表頭點擊排序
function setupTableSorting() {
    const tableHeaders = document.querySelectorAll('#mod-table th[data-sortable]');
    
    tableHeaders.forEach(header => {
        header.style.cursor = 'pointer';
        header.style.userSelect = 'none';
        
        // 添加排序指示器
        const sortIndicator = document.createElement('span');
        sortIndicator.className = 'sort-indicator';
        sortIndicator.innerHTML = ' ↕️';
        header.appendChild(sortIndicator);
        
        header.addEventListener('click', async () => {
            const column = header.dataset.sortable;
            
            // 切換排序方向
            if (sortState.column === column) {
                sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortState.column = column;
                sortState.direction = 'asc';
            }
            
            // 更新所有指示器
            tableHeaders.forEach(h => {
                const indicator = h.querySelector('.sort-indicator');
                if (h === header) {
                    indicator.innerHTML = sortState.direction === 'asc' ? ' ↑' : ' ↓';
                } else {
                    indicator.innerHTML = ' ↕️';
                }
            });
            
            // 獲取當前 mods 並排序
            try {
                const mods = await window.api.getMods();
                const sortedMods = sortMods(mods, sortState.column, sortState.direction);
                renderModTable(sortedMods);
            } catch (error) {
                console.error('Failed to sort mods:', error);
            }
        });
    });
}


function setupEventListeners() {
    const selectModBtn = document.getElementById('select-file-btn');
    const selectAllBtn = document.getElementById('select-all-btn');
    const setGamePathBtn = document.getElementById('set-game-path-btn');
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const statusMessageElement = document.getElementById('status-message');
    const applyBtn = document.getElementById('apply-mods-btn');
    const uninstallBtn = document.getElementById('uninstall-mods-btn');
    const launchGameBtn = document.getElementById('launch-game-btn');
    const actionStatusElement = document.getElementById('action-status');

    // Theme toggle event listener with enhanced feedback
    themeToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleTheme();
        // Add visual feedback
        themeToggleBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            themeToggleBtn.style.transform = '';
        }, 150);
    });

    applyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        applyBtn.disabled = true;
        applyBtn.classList.add('loading');
        actionStatusElement.innerText = i18next.t('action_status_applying');
        try {
            
            const tableBody = document.getElementById('mod-table-body');
            const selectedCheckboxes = tableBody.querySelectorAll('input[type="checkbox"]:checked');

            if (selectedCheckboxes.length === 0) {
                actionStatusElement.innerText = i18next.t('action_status_no_mods_selected');
                setTimeout(() => { actionStatusElement.innerText = ''; }, 3000);
                return;
            }
            const selectedModIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.modId);
            const result = await window.api.applyMods(selectedModIds);

            actionStatusElement.innerText = result.message;
            setTimeout(() => { actionStatusElement.innerText = ''; }, 5000);
        } finally {
            applyBtn.disabled = false;
            applyBtn.classList.remove('loading');
        }
    });

    selectModBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        selectModBtn.disabled = true;
        selectModBtn.classList.add('loading');

        try {
            const mods = await window.api.selectModFiles();
            if (mods) renderModTable(mods);
        } finally {
            selectModBtn.disabled = false;
            selectModBtn.classList.remove('loading');
        }
    });

    selectAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        selectAllMods();
        // Add visual feedback
        selectAllBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            selectAllBtn.style.transform = '';
        }, 150);
    });

    setGamePathBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        setGamePathBtn.disabled = true;
        setGamePathBtn.classList.add('loading');

        try {
            const paths = await window.api.selectGamePath();
            if (paths) updateGamePathDisplay(paths);
        } finally {
            setGamePathBtn.disabled = false;
            setGamePathBtn.classList.remove('loading');
        }
    });

    uninstallBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const tableBody = document.getElementById('mod-table-body');
        const selectedCheckboxes = tableBody.querySelectorAll('input[type="checkbox"]:checked');

        if (selectedCheckboxes.length === 0) {
            actionStatusElement.innerText = i18next.t('action_status_no_mods_selected');
            setTimeout(() => { actionStatusElement.innerText = ''; }, 3000);
            return;
        }

        const selectedModIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.modId);

        uninstallBtn.disabled = true;
        uninstallBtn.classList.add('loading');
        actionStatusElement.innerText = i18next.t('action_status_uninstalling');

        try {
            const result = await window.api.uninstallMods(selectedModIds);
            actionStatusElement.innerText = result.message; // 顯示最終結果

            // Refresh the mod table after uninstall
            const updatedMods = await window.api.getMods();
            renderModTable(updatedMods);

            setTimeout(() => { actionStatusElement.innerText = ''; }, 5000);
        } finally {
            uninstallBtn.disabled = false;
            uninstallBtn.classList.remove('loading');
        }
    });

    launchGameBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        launchGameBtn.disabled = true;
        launchGameBtn.classList.add('loading');
        actionStatusElement.innerText = i18next.t('action_status_launching');

        try {
            await window.api.launchGame();
            setTimeout(() => { actionStatusElement.innerText = ''; }, 3000);
        } finally {
            launchGameBtn.disabled = false;
            launchGameBtn.classList.remove('loading');
        }
    });

    // BAMT button event listener
    const bamtBtn = document.getElementById('BAMT');
    bamtBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        bamtBtn.disabled = true;
        bamtBtn.classList.add(i18next.t('loading'));
        actionStatusElement.innerText = i18next.t('action_status_opening_bamt');

        try {
            await window.api.openBAMT();
            actionStatusElement.innerText = i18next.t('bamt_window_opened');
            setTimeout(() => { actionStatusElement.innerText = ''; }, 3000);
        } catch (error) {
            actionStatusElement.innerText = i18next.t('bamt_window_open_failed', { error: error.message });
            setTimeout(() => { actionStatusElement.innerText = ''; }, 5000);
        } finally {
            bamtBtn.disabled = false;
            bamtBtn.classList.remove(i18next.t('loading'));
        }
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

    window.api.onModsRefresh(async () => {
        try {
            const mods = await window.api.getMods();
            renderModTable(mods);
        } catch (error) {
            console.error('Failed to refresh mods table:', error);
        }
    });
    
    // 設置表格排序功能
    setupTableSorting();
}

function renderModTable(mods) {
    const tableBody = document.getElementById('mod-table-body');
    tableBody.innerHTML = ''; // 清空舊的內容

    // 如果有排序狀態，應用排序
    let displayMods = mods;
    if (sortState.column && sortState.direction) {
        displayMods = sortMods(mods, sortState.column, sortState.direction);
    }

    if (!displayMods || displayMods.length === 0) {
        const row = tableBody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 6; // Updated to 6 columns (added character column)
        cell.textContent = i18next.t('no_mods_installed');
        cell.style.textAlign = 'center';
        return;
    }

    // Detect conflicts
    const conflicts = detectConflictingMods(displayMods);
    const hasConflicts = Object.values(conflicts).some(versions => versions.length > 1);

    displayMods.forEach(mod => {
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
            fileNameCell.className = 'conflict-filename';
            fileNameCell.title = i18next.t('conflicting_mod_warning', { filename: mod.fileName });
        }

        // Character column (new)
        const characterCell = row.insertCell();
        characterCell.textContent = mod.character || '';
        characterCell.className = 'character-cell';

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

        // 安裝日期
        const installedDateCell = row.insertCell();
        const installedDate = mod.installedDate ? new Date(mod.installedDate) : null;
        if (installedDate && !isNaN(installedDate)) {
            installedDateCell.textContent = installedDate.toLocaleDateString('zh-TW', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } else {
            installedDateCell.textContent = i18next.t('unknown_install_date');
        }
        installedDateCell.style.fontSize = '0.9rem';
        installedDateCell.style.color = '#6c757d';

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
        warningCell.colSpan = 5; // Updated to 5 columns
        warningCell.className = 'conflict-warning';
        warningCell.innerHTML = '<strong>⚠️ ' + i18next.t('conflicting_mod_warning', { filename: '' }).replace(' {{filename}}', '') + '</strong>';
        warningCell.style.textAlign = 'center';
        warningCell.style.padding = '10px';
    }
}


document.addEventListener('DOMContentLoaded', async () => {
    // Initialize theme before other content
    const storedTheme = getStoredTheme();
    applyTheme(storedTheme);

    await initializeI18n();
    setupEventListeners();

    const initialPaths = await window.config.getGamePath();
    updateGamePathDisplay(initialPaths);

    const initialMods = await window.api.getMods();
    renderModTable(initialMods);
});