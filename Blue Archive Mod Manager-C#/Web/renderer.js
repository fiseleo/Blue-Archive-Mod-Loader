// renderer.js - Frontend logic for Blue Archive Mod Loader
// Debug version with extensive logging

let sortState = {
    column: null,
    direction: 'asc'
};

let allMods = [];
let currentLanguage = 'en';
let translations = {};

function normalizeMod(raw) {
    if (!raw) return {};
    return {
        id: raw.id || raw.Id,
        fileName: raw.fileName || raw.FileName,
        actualFileName: raw.actualFileName || raw.ActualFileName,
        modName: raw.modName || raw.ModName,
        enabled: raw.enabled ?? raw.Enabled,
        path: raw.path || raw.Path,
        installedDate: raw.installedDate || raw.InstalledDate,
        character: raw.character || raw.Character,
        characterId: raw.characterId || raw.CharacterId,
        characterDev: raw.characterDev || raw.CharacterDev,
        lastLanguage: raw.lastLanguage || raw.LastLanguage
    };
}

function toCsharpMod(mod) {
    return {
        Id: mod.id,
        FileName: mod.fileName,
        ActualFileName: mod.actualFileName,
        ModName: mod.modName,
        Enabled: mod.enabled,
        Path: mod.path,
        InstalledDate: mod.installedDate,
        Character: mod.character,
        CharacterId: mod.characterId,
        CharacterDev: mod.characterDev,
        LastLanguage: mod.lastLanguage
    };
}

async function loadTranslations() {
    try {
        const res = await CSharpBridge.invoke('getTranslations');
        if (res && !res.error) {
            translations = res;
        } else {
            throw new Error(res?.error ?? 'unknown');
        }
    } catch (e) {
        console.error('[i18n] Failed to load translations, using fallback', e);
        translations = { en: { 'app.title': 'Blue Archive Mod Loader' } };
    }
}

function isPathSet(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    const notSet = [t('status.notSet'), 'Not Set', '未设定', '未設定'];
    return !notSet.includes(trimmed);
}

function getInitialLanguage() {
    const stored = localStorage.getItem('lang');
    if (stored && translations[stored]) return stored;
    const nav = navigator.language?.toLowerCase();
    if (nav) {
        if (nav.startsWith('zh-tw') || nav.includes('zh-hant')) return 'zh-TW';
        if (nav.startsWith('zh')) return 'zh';
    }
    return 'en';
}

function t(key) {
    return translations[currentLanguage]?.[key] ?? translations.en[key] ?? key;
}

function applyI18n() {
    document.title = t('app.title');
    const langSelect = document.getElementById('language-select');
    if (langSelect) langSelect.value = currentLanguage;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const text = t(key);
        if (!text) return;

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.setAttribute('placeholder', text);
        } else {
            el.innerText = text;
        }
    });
}

function initI18n() {
    currentLanguage = getInitialLanguage();
    applyI18n();

    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.value = currentLanguage;
        langSelect.addEventListener('change', (e) => {
            const lang = e.target.value;
            if (translations[lang]) {
                currentLanguage = lang;
                localStorage.setItem('lang', lang);
                applyI18n();
            }
        });
    }
}

console.log('[Init] Renderer script starting...');

// Verify WebView2 API is available
if (window.chrome && window.chrome.webview) {
    console.log('[Init] WebView2 API available');
} else {
    console.error('[Init] WebView2 API NOT available!');
}

// Communication with C# backend using WebView2 PostMessage API
class CSharpBridge {
    static _pendingResponses = new Map();

    static async invoke(method, payload = null) {
        return new Promise((resolve) => {
            try {
                if (!window.chrome || !window.chrome.webview) {
                    console.error('[CSharpBridge] WebView2 API not available');
                    resolve(null);
                    return;
                }

                const messageId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
                console.log(`[CSharpBridge] Invoking: ${method}`, payload);
                
                // Store the resolver
                CSharpBridge._pendingResponses.set(messageId, {
                    method,
                    resolve,
                    timeout: setTimeout(() => {
                        CSharpBridge._pendingResponses.delete(messageId);
                        console.warn(`[CSharpBridge] Timeout for: ${method}`);
                        resolve(null);
                    }, 30000)
                });
                
                // Send message to C#
                console.log(`[CSharpBridge] Sending:`, { method, payload, id: messageId });
                window.chrome.webview.postMessage({
                    method,
                    payload,
                    id: messageId
                });
            } catch (e) {
                console.error('[CSharpBridge] Exception in invoke:', e);
                resolve(null);
            }
        });
    }

    static onNotification(eventName, callback) {
        if (!window.chrome || !window.chrome.webview) {
            console.error('[CSharpBridge] WebView2 API not available for notification');
            return;
        }

        window.chrome.webview.addEventListener('message', (event) => {
            try {
                const data = event.data;
                console.log('[CSharpBridge] Received message:', data);
                
                // Handle responses
                if (data && data.method === 'response' && data.data) {
                    const responseMethod = data.data.method;
                    const pending = CSharpBridge._pendingResponses.get(data.id);
                    
                    if (pending) {
                        clearTimeout(pending.timeout);
                        console.log(`[CSharpBridge] Resolved: ${responseMethod}`, data.data.result);
                        pending.resolve(data.data.result || data.data.error);
                        CSharpBridge._pendingResponses.delete(data.id);
                    }
                }
                // Handle notifications
                else if (data && data.method === eventName) {
                    console.log(`[CSharpBridge] Notification ${eventName}:`, data.data);
                    callback(data.data);
                }
            } catch (e) {
                console.error('[CSharpBridge] Error in message handler:', e);
            }
        });
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[App] DOM Content Loaded');
    await loadTranslations();
    initI18n();
    initializeTheme();
    setupEventListeners();
    await loadGamePaths();
    await autoFindGamePathIfMissing();
    await loadMods();
    console.log('[App] Initialization complete');
});

function initializeTheme() {
    const storedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(storedTheme);
}

function getStoredTheme() {
    return localStorage.getItem('theme') || 'light';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeIcon = document.querySelector('.theme-icon');
    if (themeIcon) {
        themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
}

function toggleTheme() {
    console.log('[toggleTheme] Called');
    const currentTheme = getStoredTheme();
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
}

function setupEventListeners() {
console.log('[setupEventListeners] Setting up all listeners...');
    
const buttons = {
    'theme-toggle-btn': toggleTheme,
    'set-game-path-btn': selectGamePath,
    'select-file-btn': selectModFiles,
    'select-all-btn': selectAllMods,
    'apply-mods-btn': applyMods,
    'uninstall-mods-btn': uninstallMods,
    'launch-game-btn': launchGame
};

    for (const [btnId, handler] of Object.entries(buttons)) {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', (e) => {
                console.log(`[Event] Clicked: ${btnId}`);
                e.preventDefault();
                handler();
            });
            console.log(`[setupEventListeners] Registered: ${btnId}`);
        } else {
            console.warn(`[setupEventListeners] Button not found: ${btnId}`);
        }
    }

    // Sort handlers
    document.querySelectorAll('[data-sortable]').forEach(header => {
        header.addEventListener('click', () => {
            const column = header.getAttribute('data-sortable');
            console.log('[Event] Sort column:', column);
            sortMods(column);
        });
    });
    
    console.log('[setupEventListeners] Complete');
}

async function loadGamePaths() {
    try {
        console.log('[loadGamePaths] Starting...');
        const paths = await CSharpBridge.invoke('getGamePath');
        console.log('[loadGamePaths] Result:', paths);
        if (paths) {
            document.getElementById('game-path').innerText = paths.gamePath || t('status.notSet');
            document.getElementById('game-bundle-path').innerText = paths.gameBundlePath || t('status.notSet');
        }
    } catch (e) {
        console.error('[loadGamePaths] Error:', e);
    }
}

async function selectGamePath() {
    try {
        console.log('[selectGamePath] Starting...');
        document.getElementById('status-message').innerText = t('status.detectingGamePath');
        const paths = await CSharpBridge.invoke('selectGamePath');
        console.log('[selectGamePath] Result:', paths);
        if (paths) {
            document.getElementById('game-path').innerText = paths.gamePath;
            document.getElementById('game-bundle-path').innerText = paths.gameBundlePath;
            document.getElementById('status-message').innerText = t('status.gamePathDetected');
        }
    } catch (e) {
        console.error('[selectGamePath] Error:', e);
        document.getElementById('status-message').innerText = t('status.detectGamePathFailed');
    }
}

async function findGamePathAuto(fromAuto = false) {
    try {
        console.log('[findGamePathAuto] Starting...');
        document.getElementById('status-message').innerText = t('status.detectingGamePath');
        const btn = document.getElementById('find-game-path-auto-btn');
        if (btn && !fromAuto) btn.disabled = true;

        const result = await CSharpBridge.invoke('findGamePathAuto');
        console.log('[findGamePathAuto] Result:', result);
        
        if (result && result.gamePath) {
            document.getElementById('game-path').innerText = result.gamePath;
            document.getElementById('game-bundle-path').innerText = result.gameBundlePath;
            document.getElementById('status-message').innerText = t('status.gamePathDetected');
        } else if (result && result.error) {
            document.getElementById('status-message').innerText = `${t('status.detectGamePathFailed')}: ${result.error}`;
        } else {
            document.getElementById('status-message').innerText = t('status.detectGamePathFailed');
        }

        if (btn && !fromAuto) btn.disabled = false;
    } catch (e) {
        console.error('[findGamePathAuto] Error:', e);
        document.getElementById('status-message').innerText = t('status.detectGamePathFailed');
        const btn = document.getElementById('find-game-path-auto-btn');
        if (btn && !fromAuto) btn.disabled = false;
    }
}

async function autoFindGamePathIfMissing() {
    const gp = document.getElementById('game-path')?.innerText;
    const bp = document.getElementById('game-bundle-path')?.innerText;
    if (!isPathSet(gp) || !isPathSet(bp)) {
        await findGamePathAuto(true);
    }
}

async function selectModFiles() {
    try {
        console.log('[selectModFiles] Starting...');
        const result = await CSharpBridge.invoke('selectModFiles');
        console.log('[selectModFiles] Result:', result);
        if (result) {
            await loadMods();
            if (result.errors && result.errors.length > 0) {
                alert(t('alert.failedMods') + '\n' + result.errors.join('\n'));
            }
        }
    } catch (e) {
        console.error('[selectModFiles] Error:', e);
    }
}

async function loadMods() {
    try {
        console.log('[loadMods] Starting...');
        const modsRaw = await CSharpBridge.invoke('getMods') || [];
        allMods = modsRaw.map(normalizeMod);
        console.log('[loadMods] Loaded', allMods.length, 'mods');
        renderModTable();
    } catch (e) {
        console.error('[loadMods] Error:', e);
    }
}

function renderModTable() {
    const tbody = document.getElementById('mod-table-body');
    tbody.innerHTML = '';

    if (!allMods || allMods.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="6" style="text-align: center; padding: 2rem;">${t('status.noMods')}</td>`;
        tbody.appendChild(row);
        return;
    }

    allMods.forEach(mod => {
        const row = document.createElement('tr');
        const date = mod.installedDate ? new Date(mod.installedDate) : null;
        const dateStr = date instanceof Date && !isNaN(date) ? date.toLocaleDateString() : '-';
        const fileName = mod.fileName || mod.actualFileName || (mod.path ? mod.path.split(/[/\\]/).pop() : '');
        const character = mod.character || 'Unknown';
        const modName = mod.modName || fileName || 'Unknown';

        row.innerHTML = `
            <td class="col-checkbox">
                <input type="checkbox" data-mod-id="${mod.id}" ${mod.enabled ? 'checked' : ''} 
                       onchange="updateModEnabled('${mod.id}', this.checked)">
            </td>
            <td class="col-filename">${escapeHtml(fileName)}</td>
            <td class="col-character">${escapeHtml(character)}</td>
            <td class="col-modname">${escapeHtml(modName)}</td>
            <td class="col-date">${dateStr}</td>
            <td class="col-actions">
                <button class="delete-btn" onclick="deleteMod('${mod.id}')" title="Delete">🗑️</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function sortMods(column) {
    const newDirection = sortState.column === column && sortState.direction === 'asc' ? 'desc' : 'asc';
    sortState.column = column;
    sortState.direction = newDirection;

    allMods.sort((a, b) => {
        let aVal = a[column];
        let bVal = b[column];

        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }

        if (aVal < bVal) return newDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return newDirection === 'asc' ? 1 : -1;
        return 0;
    });

    renderModTable();
}

async function updateModEnabled(modId, enabled) {
    const mod = allMods.find(m => m.id === modId);
    if (mod) {
        mod.enabled = enabled;
        console.log('[updateModEnabled]', modId, enabled);
        await CSharpBridge.invoke('updateMod', toCsharpMod(mod));
    }
}

async function deleteMod(modId) {
    if (confirm(t('alert.deleteConfirm'))) {
        console.log('[deleteMod]', modId);
        await CSharpBridge.invoke('deleteMod', modId);
        await loadMods();
    }
}

function selectAllMods() {
    console.log('[selectAllMods] Called');
    const checkboxes = document.querySelectorAll('#mod-table-body input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach(cb => {
        cb.checked = !allChecked;
        const modId = cb.getAttribute('data-mod-id');
        updateModEnabled(modId, cb.checked);
    });
}

async function applyMods() {
    console.log('[applyMods] Called');
    const selectedIds = allMods
        .filter(m => m.enabled)
        .map(m => m.id);
    
    if (selectedIds.length === 0) {
        alert(t('status.selectAtLeastOne'));
        return;
    }

    console.log('[applyMods] Applying:', selectedIds);
    document.getElementById('action-status').innerText = t('status.applyMods');
    
    try {
        await CSharpBridge.invoke('applyMods', selectedIds);
        document.getElementById('action-status').innerText = t('status.applyModsSuccess');
    } catch (e) {
        console.error('[applyMods] Error:', e);
        document.getElementById('action-status').innerText = t('status.applyModsFail');
    }
}

async function uninstallMods() {
    console.log('[uninstallMods] Called');
    const selectedIds = allMods
        .filter(m => m.enabled)
        .map(m => m.id);
    
    if (selectedIds.length === 0) {
        alert(t('status.selectAtLeastOne'));
        return;
    }

    if (!confirm(t('alert.uninstallConfirm'))) {
        return;
    }

    console.log('[uninstallMods] Uninstalling:', selectedIds);
    document.getElementById('action-status').innerText = t('status.uninstallMods');
    
    try {
        await CSharpBridge.invoke('uninstallMods', selectedIds);
        document.getElementById('action-status').innerText = t('status.uninstallModsSuccess');
    } catch (e) {
        console.error('[uninstallMods] Error:', e);
        document.getElementById('action-status').innerText = t('status.uninstallModsFail');
    }
}

async function launchGame() {
    console.log('[launchGame] Called');
    try {
        document.getElementById('action-status').innerText = t('status.launchingGame');
        await CSharpBridge.invoke('launchGame');
        setTimeout(() => {
            document.getElementById('action-status').innerText = t('status.gameLaunched');
        }, 1000);
    } catch (e) {
        console.error('[launchGame] Error:', e);
        document.getElementById('action-status').innerText = t('status.launchGameFail');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Notification handlers
CSharpBridge.onNotification('statusUpdate', (message) => {
    console.log('[Notification] Status:', message);
    document.getElementById('status-message').innerText = message;
});

CSharpBridge.onNotification('gamePathStatus', (data) => {
    console.log('[Notification] Game path status:', data);
    if (data && data.status) {
        document.getElementById('status-message').innerText = data.status;
    }
});

CSharpBridge.onNotification('modsRefresh', () => {
    console.log('[Notification] Mods refresh');
    loadMods();
});

CSharpBridge.onNotification('gamePaths', (paths) => {
    console.log('[Notification] Game paths:', paths);
    document.getElementById('game-path').innerText = paths.gamePath;
    document.getElementById('game-bundle-path').innerText = paths.gameBundlePath;
});

console.log('[Init] Renderer script fully loaded and ready');
