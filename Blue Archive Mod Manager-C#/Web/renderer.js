// renderer.js - Frontend logic for Blue Archive Mod Loader
// Debug version with extensive logging

let sortState = {
    column: null,
    direction: 'asc'
};

let allMods = [];
let _pendingResponses = new Map();

console.log('[Init] Renderer script starting...');

// Verify WebView2 API is available
if (window.chrome && window.chrome.webview) {
    console.log('[Init] WebView2 API available');
} else {
    console.error('[Init] WebView2 API NOT available!');
}

// Communication with C# backend using WebView2 PostMessage API
class CSharpBridge {
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
                _pendingResponses.set(messageId, {
                    method,
                    resolve,
                    timeout: setTimeout(() => {
                        _pendingResponses.delete(messageId);
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
                    const pending = _pendingResponses.get(data.id);
                    
                    if (pending) {
                        clearTimeout(pending.timeout);
                        console.log(`[CSharpBridge] Resolved: ${responseMethod}`, data.data.result);
                        pending.resolve(data.data.result || data.data.error);
                        _pendingResponses.delete(data.id);
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
    initializeTheme();
    setupEventListeners();
    await loadGamePaths();
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
            document.getElementById('game-path').innerText = paths.gamePath || 'Not Set';
            document.getElementById('game-bundle-path').innerText = paths.gameBundlePath || 'Not Set';
        }
    } catch (e) {
        console.error('[loadGamePaths] Error:', e);
    }
}

async function selectGamePath() {
    try {
        console.log('[selectGamePath] Starting...');
        document.getElementById('status-message').innerText = 'Detecting game path...';
        const paths = await CSharpBridge.invoke('selectGamePath');
        console.log('[selectGamePath] Result:', paths);
        if (paths) {
            document.getElementById('game-path').innerText = paths.gamePath;
            document.getElementById('game-bundle-path').innerText = paths.gameBundlePath;
            document.getElementById('status-message').innerText = 'Game path detected!';
        }
    } catch (e) {
        console.error('[selectGamePath] Error:', e);
        document.getElementById('status-message').innerText = 'Failed to detect game path';
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
                alert('Some mods failed to load:\n' + result.errors.join('\n'));
            }
        }
    } catch (e) {
        console.error('[selectModFiles] Error:', e);
    }
}

async function loadMods() {
    try {
        console.log('[loadMods] Starting...');
        allMods = await CSharpBridge.invoke('getMods') || [];
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
        row.innerHTML = '<td colspan="6" style="text-align: center; padding: 2rem;">No mods installed yet</td>';
        tbody.appendChild(row);
        return;
    }

    allMods.forEach(mod => {
        const row = document.createElement('tr');
        const date = new Date(mod.installedDate);
        const dateStr = date.toLocaleDateString();

        row.innerHTML = `
            <td class="col-checkbox">
                <input type="checkbox" data-mod-id="${mod.id}" ${mod.enabled ? 'checked' : ''} 
                       onchange="updateModEnabled('${mod.id}', this.checked)">
            </td>
            <td class="col-filename">${escapeHtml(mod.fileName)}</td>
            <td class="col-character">${escapeHtml(mod.character || 'Unknown')}</td>
            <td class="col-modname">${escapeHtml(mod.modName)}</td>
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
        await CSharpBridge.invoke('updateMod', mod);
    }
}

async function deleteMod(modId) {
    if (confirm('Are you sure you want to delete this mod?')) {
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
        alert('Please select at least one mod to apply');
        return;
    }

    console.log('[applyMods] Applying:', selectedIds);
    document.getElementById('action-status').innerText = 'Applying mods...';
    
    try {
        await CSharpBridge.invoke('applyMods', selectedIds);
        document.getElementById('action-status').innerText = 'Mods applied successfully!';
    } catch (e) {
        console.error('[applyMods] Error:', e);
        document.getElementById('action-status').innerText = 'Failed to apply mods';
    }
}

async function uninstallMods() {
    console.log('[uninstallMods] Called');
    const selectedIds = allMods
        .filter(m => m.enabled)
        .map(m => m.id);
    
    if (selectedIds.length === 0) {
        alert('Please select at least one mod to uninstall');
        return;
    }

    if (!confirm('Are you sure you want to uninstall the selected mods?')) {
        return;
    }

    console.log('[uninstallMods] Uninstalling:', selectedIds);
    document.getElementById('action-status').innerText = 'Uninstalling mods...';
    
    try {
        await CSharpBridge.invoke('uninstallMods', selectedIds);
        document.getElementById('action-status').innerText = 'Mods uninstalled successfully!';
    } catch (e) {
        console.error('[uninstallMods] Error:', e);
        document.getElementById('action-status').innerText = 'Failed to uninstall mods';
    }
}

async function launchGame() {
    console.log('[launchGame] Called');
    try {
        document.getElementById('action-status').innerText = 'Launching game...';
        await CSharpBridge.invoke('launchGame');
        setTimeout(() => {
            document.getElementById('action-status').innerText = 'Game launched!';
        }, 1000);
    } catch (e) {
        console.error('[launchGame] Error:', e);
        document.getElementById('action-status').innerText = 'Failed to launch game';
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
