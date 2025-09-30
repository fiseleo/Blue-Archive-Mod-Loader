(() => {
	const i18next = window.i18next;
	if (!i18next) {
		throw new Error('i18next global is unavailable. Ensure i18next.min.js is loaded before bamt.js.');
	}

	let shell = null;
	let ipcRenderer = null;
	let path = null;
	let fs = null;
	let fastGlob = null;
	let os = null;

	try {
		const electron = require('electron');
		shell = electron.shell;
		ipcRenderer = electron.ipcRenderer;
	} catch (error) {
		console.warn('Electron renderer APIs are unavailable:', error);
	}

	try {
		path = require('path');
	} catch (error) {
		path = null;
	}

	try {
		fs = require('fs');
	} catch (error) {
		fs = null;
	}

	try {
		fastGlob = require('fast-glob');
	} catch (error) {
		fastGlob = null;
	}

	try {
		os = require('os');
	} catch (error) {
		os = null;
	}

	const state = {
		gameResourcePath: '',
		outputDirPath: '',
		oldMod: null,
		oldModFile: null,
		newBundle: null,
		newBundleFile: null,
		modOutputName: '',
		pngBundle: null,
		pngBundleFile: null,
		pngFolder: null,
		defaultOutputDir: '',
		lastProcessedFiles: {
			modUpdate: null,
			pngReplace: null,
		},
	};

	const CACHE_SUBDIR = '.bamt-cache';

	const options = {
		replaceTexture: true,
		replaceTextasset: false,
		replaceMesh: false,
	};

	const captionConfig = {
		'old-mod': { el: document.getElementById('old-mod-caption'), stateKey: 'oldMod', defaultKey: 'bamt.drop.noSelectionFile' },
		'new-bundle': { el: document.getElementById('new-bundle-caption'), stateKey: 'newBundle', defaultKey: 'bamt.drop.noSelectionFile' },
		'png-bundle': { el: document.getElementById('png-bundle-caption'), stateKey: 'pngBundle', defaultKey: 'bamt.drop.noSelectionFile' },
		'png-folder': { el: document.getElementById('png-folder-caption'), stateKey: 'pngFolder', defaultKey: 'bamt.drop.noSelectionFolder' },
	};

	const hiddenInputs = {
		'old-mod': document.getElementById('picker-old-mod'),
		'new-bundle': document.getElementById('picker-new-bundle'),
		'png-bundle': document.getElementById('picker-png-bundle'),
		'png-folder': document.getElementById('picker-png-folder'),
		'game-resource': document.getElementById('picker-game-resource'),
		'output-dir': document.getElementById('picker-output-dir'),
	};

	const autoFindPrefixInput = document.getElementById('auto-find-prefix');
	const modOutputNameInput = document.getElementById('mod-output-name');
	const gameResourceField = document.getElementById('game-resource-path');
	const outputDirField = document.getElementById('output-dir-path');
	const logOutput = document.getElementById('log-output');
	const logCounter = document.getElementById('log-counter');
	const statusIndicator = document.getElementById('global-status');
	const resetLogBtn = document.getElementById('reset-log-btn');

	let logLineCount = 0;

	const OPTION_LABEL_KEYS = {
		replaceTexture: 'bamt.options.replaceTexture',
		replaceTextasset: 'bamt.options.replaceTextasset',
		replaceMesh: 'bamt.options.replaceMesh',
	};

	const SUPPORTED_LANGS = ['en', 'zh-TW', 'zh-CN'];

	function t(key, options) {
		if (i18next && i18next.isInitialized) {
			return i18next.t(key, options);
		}
		return options && options.defaultValue ? options.defaultValue : key;
	}

	async function initializeI18n() {
		const locale = ipcRenderer ? await ipcRenderer.invoke('i18n:getLocale') : 'en';
		const resources = {};

		await Promise.all(
			SUPPORTED_LANGS.map(async (lng) => {
				try {
					const response = await fetch(`../locales/${lng}/translation.json`);
					if (!response.ok) {
						throw new Error(`Failed to load ${lng} translation`);
					}
					const data = await response.json();
					resources[lng] = { translation: data };
				} catch (error) {
					console.error(`Unable to load locale file for ${lng}:`, error);
				}
			})
		);

		await i18next.init({
			lng: locale,
			fallbackLng: 'en',
			resources,
			interpolation: { escapeValue: false },
		});
	}

	function applyTranslations() {
		document.documentElement.lang = i18next.language || 'en';
		document.title = t('bamt.document.title');

		document.querySelectorAll('[data-i18n]').forEach((el) => {
			const key = el.dataset.i18n;
			if (key) {
				el.textContent = t(key);
			}
		});

		document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
			const key = el.dataset.i18nPlaceholder;
			if (key) {
				el.setAttribute('placeholder', t(key));
			}
		});

		Object.values(captionConfig).forEach((config) => {
			if (!state[config.stateKey]) {
				config.el.textContent = t(config.defaultKey);
			}
		});

		updateLogCounter();
		setStatus(t('bamt.status.idle'));
	}

	function formatPath(file) {
		if (!file) return '';
		if (file.path) return file.path;
		return file.name || '';
	}

	function setCaption(target, message) {
		const config = captionConfig[target];
		if (!config) return;
		if (message) {
			config.el.textContent = message;
		} else {
			config.el.textContent = t(config.defaultKey);
		}
	}

	function normalizePath(value) {
		if (!value) return '';
		const stringValue = value.toString().trim();
		if (!stringValue) return '';
		const withForwardSlashes = stringValue.replace(/\\/g, '/');
		const withoutTrailingSlashes = withForwardSlashes.replace(/\/+$/g, '');
		return withoutTrailingSlashes.toLowerCase();
	}

	function applyGameResourcePath(resourcePath, { logOnSameValue = false, suppressLog = false } = {}) {
		const normalizedPath = resourcePath || '';
		const hasChanged = normalizedPath !== state.gameResourcePath;
		state.gameResourcePath = normalizedPath;
		if (gameResourceField) {
			gameResourceField.value = normalizedPath;
		}
		if (!normalizedPath) {
			if (!suppressLog && (logOnSameValue || hasChanged)) {
				log(t('bamt.log.gameResourceMissing'), 'warning');
			}
			return false;
		}
		if (!suppressLog && (hasChanged || logOnSameValue)) {
			log(t('bamt.log.gameResourceSynced', { path: normalizedPath }), 'success');
		}
		return hasChanged;
	}

	function updateGameResourceFromPaths(paths, options = {}) {
		if (!paths || !paths.gameBundlePath) {
			applyGameResourcePath('', {
				logOnSameValue: options.logOnMissing,
				suppressLog: !options.logOnMissing,
			});
			return false;
		}
		return applyGameResourcePath(paths.gameBundlePath, {
			logOnSameValue: options.logOnUnchanged,
			suppressLog: !!options.suppressLog,
		});
	}

	async function syncGameResourcePath() {
		if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
			return;
		}
		try {
			const paths = await ipcRenderer.invoke('config:getGamePath');
			const changed = updateGameResourceFromPaths(paths, {
				logOnUnchanged: true,
				logOnMissing: true,
			});
			if (!changed && state.gameResourcePath) {
				// Already synced; no additional action needed.
			}
		} catch (error) {
			console.error('Failed to synchronize game resource path:', error);
			log(t('bamt.log.gameResourceLoadError', { error: error.message || String(error) }), 'error');
		}
	}

	function applyOutputDirPath(dirPath, { logOnSameValue = false, logKey = 'bamt.log.outputDirSet', suppressLog = false } = {}) {
		const value = dirPath || '';
		const hasChanged = value !== state.outputDirPath;
		state.outputDirPath = value;
		if (outputDirField) {
			outputDirField.value = value;
		}
		if (!value) {
			if (!suppressLog && (logOnSameValue || hasChanged)) {
				log(t('bamt.validation.missing', { target: t('bamt.validation.outputDir') }), 'warning');
			}
			return false;
		}
		if (!suppressLog && (hasChanged || logOnSameValue)) {
			log(t(logKey, { path: value }), 'success');
		}
		return hasChanged;
	}

	async function syncOutputDirPath() {
		if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
			return;
		}
		try {
			const defaultDir = await ipcRenderer.invoke('config:getDefaultOutputDir');
			state.defaultOutputDir = defaultDir || '';
			if (defaultDir && !state.outputDirPath) {
				applyOutputDirPath(defaultDir, { logOnSameValue: true, logKey: 'bamt.log.outputDirSynced' });
			} else if (!defaultDir && !state.outputDirPath) {
				log(t('bamt.validation.missing', { target: t('bamt.validation.outputDir') }), 'warning');
			}
		} catch (error) {
			console.error('Failed to load default output directory:', error);
			log(t('bamt.log.outputDirLoadError', { error: error.message || String(error) }), 'error');
		}
	}

	function isUsingDefaultOutputDir() {
		if (!state.defaultOutputDir) {
			return false;
		}
		return normalizePath(state.outputDirPath) === normalizePath(state.defaultOutputDir);
	}

	async function notifyModsRefresh() {
		if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
			return;
		}
		try {
			await ipcRenderer.invoke('mods:triggerRefresh');
			log(t('bamt.log.refreshModsTriggered'));
		} catch (error) {
			console.error('Failed to notify main window to refresh mods:', error);
			log(t('bamt.log.refreshModsFailed', { error: error.message || String(error) }), 'error');
		}
	}

	async function checkPythonEnvironment() {
		if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
			return;
		}
		try {
			const result = await ipcRenderer.invoke('env:checkPython');
			if (result && Array.isArray(result.logs)) {
				result.logs.forEach((line) => log(line));
			}
			if (result && result.installed) {
				const versionText = result.version ? result.version : t('bamt.log.pythonUnknownVersion');
				log(t('bamt.log.pythonFound', { command: result.command, version: versionText }), 'success');
				if (result.venvReady) {
					log(t('bamt.log.pythonVenvReady', { path: result.venvPath || '' }), 'success');
					// 啟用所有按鈕
					document.getElementById('run-mod-update').disabled = false;
					document.getElementById('replace-original').disabled = false;
					document.getElementById('run-png-replace').disabled = false;
					document.getElementById('replace-original-png').disabled = false;
				} else {
					log(t('bamt.log.pythonVenvFailed'), 'warning');
				}
			} else {
				log(t('bamt.log.pythonMissing'), 'warning');
				setStatus(t('bamt.status.pythonMissing'), 'warning');
			}
		} catch (error) {
			console.error('Failed to check Python environment:', error);
			log(t('bamt.log.pythonCheckFailed', { error: error.message || String(error) }), 'error');
		}
	}

	function registerGamePathListener() {
		if (!ipcRenderer || typeof ipcRenderer.on !== 'function') {
			return;
		}
		ipcRenderer.on('update-game-path', (_event, paths) => {
			updateGameResourceFromPaths(paths);
		});
	}

	function registerCliLogListener() {
		if (!ipcRenderer || typeof ipcRenderer.on !== 'function') {
			return;
		}
		ipcRenderer.on('bamt:cli-log', (_event, entry) => {
			if (!entry || !entry.message) {
				return;
			}
			const level = entry.level === 'error' ? 'error' : entry.level === 'warning' ? 'warning' : (entry.level === 'success' ? 'success' : 'info');
			log(entry.message, level);
		});
	}

	function updateLogCounter() {
		logCounter.textContent = t('bamt.log.counter', { count: logLineCount });
	}

	function setStatus(message, variant = 'idle') {
		const statusText = t('bamt.status.label', { message });
		statusIndicator.textContent = statusText;
		statusIndicator.classList.remove('status-success', 'status-warning', 'status-error');
		if (variant === 'success') {
			statusIndicator.classList.add('status-success');
		} else if (variant === 'warning') {
			statusIndicator.classList.add('status-warning');
		} else if (variant === 'error') {
			statusIndicator.classList.add('status-error');
		}
	}

	function log(message, type = 'info') {
		const time = new Date().toLocaleTimeString();
		const line = `[${time}] ${message}`;
		logOutput.value += `${line}\n`;
		logLineCount += 1;
		updateLogCounter();
		logOutput.scrollTop = logOutput.scrollHeight;

		if (type === 'success') {
			setStatus(message, 'success');
		} else if (type === 'warning') {
			setStatus(message, 'warning');
		} else if (type === 'error') {
			setStatus(message, 'error');
		} else {
			setStatus(message, 'idle');
		}
	}

	function clearLog() {
		logOutput.value = '';
		logLineCount = 0;
		updateLogCounter();
		setStatus(t('bamt.status.idle'));
	}

	function extractAutoPrefix(filename) {
		if (!filename) return '';
		const match = filename.match(/^(.*?)(20\d{2}-\d{2}-\d{2})/);
		if (match && match[1]) {
			return match[1].trim();
		}
		return filename.replace(/\.bundle$/i, '');
	}

	function getFileNameFromPath(filePath) {
		if (!filePath) {
			return '';
		}
		if (path && typeof path.basename === 'function') {
			return path.basename(filePath);
		}
		const parts = String(filePath).split(/[\\/]/);
		return parts[parts.length - 1] || String(filePath);
	}

	function analyzeBundleName(fileName) {
		if (!fileName || typeof fileName !== 'string') {
			return null;
		}
		const trimmed = fileName.trim();
		const lower = trimmed.toLowerCase();
		const dateMatch = trimmed.match(/20\d{2}-\d{2}-\d{2}/);
		const trailingMatch = trimmed.match(/^(.+?)(_?\d+)(\.bundle)$/i);
		const baseWithoutNumber = trailingMatch ? trailingMatch[1] : trimmed.replace(/\.bundle$/i, '');
		const trailingNumber = trailingMatch ? parseInt(trailingMatch[2].replace('_', ''), 10) : null;
		return {
			fileName: trimmed,
			lower,
			baseWithoutNumber,
			baseLower: baseWithoutNumber.toLowerCase(),
			trailingNumber: Number.isFinite(trailingNumber) ? trailingNumber : null,
			date: dateMatch ? dateMatch[0] : null,
		};
	}

	function escapeForGlob(value) {
		return value.replace(/([\\^$+?.()|{}\[\]])/g, '\\$1');
	}

	function createWildcardPattern(fileName) {
		const match = fileName.match(/^(.+?)(\d+)(\.bundle)$/i);
		if (!match) {
			return null;
		}
		const base = match[1];
		const ext = match[3];
		return `${escapeForGlob(base)}*${escapeForGlob(ext)}`;
	}

	function buildAutoFindPatterns(oldInfo, prefixValue) {
		const results = new Set();
		if (oldInfo && oldInfo.fileName) {
			const escapedExact = escapeForGlob(oldInfo.fileName);
			results.add(escapedExact);
			const wildcardPattern = createWildcardPattern(oldInfo.fileName);
			if (wildcardPattern) {
				results.add(wildcardPattern);
			}
		}
		if (prefixValue) {
			const escapedPrefix = escapeForGlob(prefixValue);
			results.add(`${escapedPrefix}*.bundle`);
		}
		return Array.from(results);
	}

	async function collectAutoFindCandidates(patterns, searchRoot) {
		if (!patterns || patterns.length === 0 || !searchRoot) {
			return [];
		}
		if (!fastGlob || typeof fastGlob !== 'function') {
			return [];
		}
		const options = {
			cwd: searchRoot,
			onlyFiles: true,
			absolute: true,
			caseSensitiveMatch: false,
			dot: false,
			suppressErrors: true,
			unique: true,
		};
		const matches = new Set();
		for (const pattern of patterns) {
			const globPattern = pattern.startsWith('**/') ? pattern : `**/${pattern}`;
			try {
				const found = await fastGlob(globPattern, options);
				found.forEach((entry) => {
					if (entry && typeof entry === 'string') {
						matches.add(path ? path.resolve(entry) : entry);
					}
				});
			} catch (error) {
				console.error('Auto-find glob failed:', pattern, error);
			}
		}
		return Array.from(matches).filter((entry) => typeof entry === 'string' && entry.toLowerCase().endsWith('.bundle'));
	}

	async function rankAutoFindCandidates(candidates, oldInfo, prefixValue) {
		if (!candidates || candidates.length === 0) {
			return [];
		}
		const prefixLower = prefixValue ? prefixValue.toLowerCase() : '';
		const statsPromises = candidates.map(async (filePath) => {
			const name = getFileNameFromPath(filePath);
			const info = analyzeBundleName(name);
			let mtimeMs = 0;
			if (fs && fs.promises && typeof fs.promises.stat === 'function') {
				try {
					const stat = await fs.promises.stat(filePath);
					mtimeMs = stat && typeof stat.mtimeMs === 'number' ? stat.mtimeMs : 0;
				} catch (error) {
					mtimeMs = 0;
				}
			}
			const nameLower = name.toLowerCase();
			return {
				path: filePath,
				name,
				info,
				mtimeMs,
				weights: {
					baseMatch: oldInfo && info ? Number(info.baseLower === oldInfo.baseLower) : 0,
					prefixMatch: prefixLower ? Number(nameLower.startsWith(prefixLower)) : 0,
					dateMatch: oldInfo && oldInfo.date ? Number(nameLower.includes(oldInfo.date.toLowerCase())) : 0,
					trailingDifferent:
						oldInfo && info && oldInfo.trailingNumber !== null && info.trailingNumber !== null
							? Number(oldInfo.trailingNumber !== info.trailingNumber)
							: 0,
				},
			};
		});
		const entries = await Promise.all(statsPromises);
		return entries.sort((a, b) => {
			if (b.weights.baseMatch !== a.weights.baseMatch) {
				return b.weights.baseMatch - a.weights.baseMatch;
			}
			if (b.weights.prefixMatch !== a.weights.prefixMatch) {
				return b.weights.prefixMatch - a.weights.prefixMatch;
			}
			if (b.weights.dateMatch !== a.weights.dateMatch) {
				return b.weights.dateMatch - a.weights.dateMatch;
			}
			if (b.weights.trailingDifferent !== a.weights.trailingDifferent) {
				return b.weights.trailingDifferent - a.weights.trailingDifferent;
			}
			return b.mtimeMs - a.mtimeMs;
		});
	}

	async function performAutoFindSearch(prefixValue) {
		if (!state.oldMod) {
			return { best: null, ranked: [] };
		}
		const searchRoot = state.gameResourcePath;
		if (!searchRoot) {
			return { best: null, ranked: [] };
		}
		const oldFileName = getFileNameFromPath(state.oldMod);
		const oldInfo = analyzeBundleName(oldFileName);
		const patterns = buildAutoFindPatterns(oldInfo, prefixValue);
		if (!patterns || patterns.length === 0) {
			return { best: null, ranked: [] };
		}
		const candidates = await collectAutoFindCandidates(patterns, searchRoot);
		if (!candidates || candidates.length === 0) {
			return { best: null, ranked: [] };
		}
		const normalizedOld = normalizePath(state.oldMod);
		const filtered = candidates.filter((candidate) => normalizePath(candidate) !== normalizedOld);
		if (filtered.length === 0) {
			return { best: null, ranked: [] };
		}
		const ranked = await rankAutoFindCandidates(filtered, oldInfo, prefixValue);
		return { best: ranked[0] || null, ranked };
	}

	function fileExists(targetPath) {
		if (!fs || !targetPath) {
			return false;
		}
		if (typeof fs.existsSync === 'function') {
			try {
				return fs.existsSync(targetPath);
			} catch (error) {
				return false;
			}
		}
		return false;
	}

	function getCacheDirectory(preferredBase) {
		if (!path) {
			return null;
		}
		const candidates = [preferredBase, state.outputDirPath, state.defaultOutputDir];
		if (os && typeof os.tmpdir === 'function') {
			candidates.push(os.tmpdir());
		}
		candidates.push(process.cwd());
		for (const base of candidates) {
			if (!base || typeof base !== 'string') {
				continue;
			}
			try {
				const absoluteBase = path.isAbsolute(base) ? base : path.resolve(base);
				return path.join(absoluteBase, CACHE_SUBDIR);
			} catch (error) {
				// ignore invalid path values
			}
		}
		return null;
	}

	async function materializeFileSelection(file, { preferredBaseDir } = {}) {
		if (!file || typeof file.arrayBuffer !== 'function' || !fs || !fs.promises || !path) {
			return null;
		}
		const cacheDir = getCacheDirectory(preferredBaseDir);
		if (!cacheDir) {
			return null;
		}
		try {
			await fs.promises.mkdir(cacheDir, { recursive: true });
		} catch (error) {
			console.error('Unable to prepare cache directory:', error);
			return null;
		}
		const baseName = file.name || `selection-${Date.now()}`;
		const safeName = baseName.replace(/[\\/]/g, '_');
		const targetPath = path.join(cacheDir, safeName);
		if (!fileExists(targetPath)) {
			try {
				const buffer = Buffer.from(await file.arrayBuffer());
				await fs.promises.writeFile(targetPath, buffer);
			} catch (error) {
				console.error('Failed to persist selection file:', error);
				return null;
			}
		}
		return targetPath;
	}

	async function resolveExistingFilePath(originalPath, extraDirs = []) {
		if (!originalPath) {
			return null;
		}
		if (!fs || !path) {
			if (typeof originalPath === 'string') {
				return originalPath;
			}
			return null;
		}
		if (fileExists(originalPath)) {
			return originalPath;
		}
		const fileName = getFileNameFromPath(originalPath);
		if (!fileName) {
			return null;
		}
		const candidateDirs = new Set();
		extraDirs.filter(Boolean).forEach((dir) => candidateDirs.add(dir));
		if (state.outputDirPath) {
			candidateDirs.add(state.outputDirPath);
		}
		if (state.gameResourcePath) {
			candidateDirs.add(state.gameResourcePath);
		}
		if (state.oldMod && typeof state.oldMod === 'string') {
			try {
				if (path.isAbsolute(state.oldMod)) {
					candidateDirs.add(path.dirname(state.oldMod));
				}
			} catch (error) {
				// ignore invalid path states
			}
		}
		if (state.newBundle && typeof state.newBundle === 'string') {
			try {
				if (path.isAbsolute(state.newBundle)) {
					candidateDirs.add(path.dirname(state.newBundle));
				}
			} catch (error) {
				// ignore invalid path states
			}
		}
		for (const dir of candidateDirs) {
			if (!dir || typeof dir !== 'string') {
				continue;
			}
			let candidate = null;
			try {
				candidate = path.join(dir, fileName);
			} catch (error) {
				candidate = null;
			}
			if (candidate && fileExists(candidate)) {
				return candidate;
			}
		}
		if (!fastGlob) {
			return null;
		}
		for (const dir of candidateDirs) {
			if (!dir || typeof dir !== 'string') {
				continue;
			}
			try {
				const results = await fastGlob(`**/${escapeForGlob(fileName)}`, {
					cwd: dir,
					onlyFiles: true,
					absolute: true,
					caseSensitiveMatch: false,
					suppressErrors: true,
					unique: true,
					deep: 5,
				});
				if (Array.isArray(results) && results.length > 0) {
					return path.resolve(results[0]);
				}
			} catch (error) {
				console.error('resolveExistingFilePath glob failed:', dir, error);
			}
		}
		return null;
	}

	async function runAutoFind(triggerButton) {
		const prerequisites = [
			ensurePath(state.oldMod, 'bamt.validation.oldMod'),
			ensurePath(state.gameResourcePath, 'bamt.validation.gameResource'),
		];
		if (!prerequisites.every(Boolean)) {
			return;
		}
		if (!path || !fs || !fs.promises || !fastGlob || typeof fastGlob !== 'function') {
			log(t('bamt.log.autoFindUnsupported'), 'warning');
			return;
		}
		const prefixValue = autoFindPrefixInput.value.trim();
		const prefixDisplay = prefixValue || t('bamt.common.notConfigured');
		try {
			if (triggerButton) {
				triggerButton.disabled = true;
			}
			const searchingMessage = t('bamt.log.autoFindSearching', { prefix: prefixDisplay });
			log(searchingMessage);
			setStatus(searchingMessage, 'warning');
			const { best, ranked } = await performAutoFindSearch(prefixValue);
			if (!best) {
				const notFoundMessage = t('bamt.log.autoFindNotFound');
				log(notFoundMessage, 'warning');
				setStatus(notFoundMessage, 'warning');
				return;
			}
			state.newBundle = best.path;
			setCaption('new-bundle', best.name);
			if (!modOutputNameInput.value.trim()) {
				modOutputNameInput.value = best.name;
			}
			state.modOutputName = modOutputNameInput.value.trim();
			if (ranked.length > 1) {
				log(t('bamt.log.autoFindMultiple', { count: ranked.length, name: best.name }));
			} else {
				log(t('bamt.log.autoFindFound', { name: best.name }));
			}
			if (path && typeof path.dirname === 'function') {
				log(t('bamt.log.autoFindFoundDetail', { name: best.name, directory: path.dirname(best.path) }), 'success');
			}
			setStatus(t('bamt.log.autoFindFound', { name: best.name }), 'success');
		} catch (error) {
			console.error('Auto-find failed:', error);
			log(t('bamt.log.autoFindError', { error: error.message || String(error) }), 'error');
		} finally {
			if (triggerButton) {
				triggerButton.disabled = false;
			}
		}
	}

	function updateOption(optionKey, value) {
		options[optionKey] = value;
		const labelKey = OPTION_LABEL_KEYS[optionKey] || optionKey;
		const stateKey = value ? 'bamt.common.enabled' : 'bamt.common.disabled';
		log(t('bamt.log.optionChange', { option: t(labelKey), state: t(stateKey) }));
	}

	function updatePathField(field, files) {
		if (!files || files.length === 0) {
			return;
		}
		const file = files[0];
		const resolvedPath = file.path || file.webkitRelativePath || file.name;

		if (field === 'game-resource') {
			applyGameResourcePath(file.path || resolvedPath, { suppressLog: true });
			log(t('bamt.log.gameResourceSet', { path: formatPath(file) }), 'success');
		} else if (field === 'output-dir') {
			const displayPath = formatPath(file);
			applyOutputDirPath(displayPath, { logKey: 'bamt.log.outputDirSet' });
		}
	}

	function updateFileSelection(target, files) {
		if (!files || files.length === 0) {
			return;
		}
		const file = files[0];
		const fullPath = formatPath(file);
		const fileName = file.name || (path ? path.basename(fullPath) : fullPath);

		setCaption(target, fileName);

		switch (target) {
			case 'old-mod':
				state.oldMod = fullPath;
				state.oldModFile = file;
				autoFindPrefixInput.value = extractAutoPrefix(fileName);
				log(t('bamt.log.selectedOldMod', { name: fileName }));
				break;
			case 'new-bundle':
				state.newBundle = fullPath;
				state.newBundleFile = file;
				if (!modOutputNameInput.value.trim()) {
					modOutputNameInput.value = fileName;
					state.modOutputName = fileName;
				}
				log(t('bamt.log.selectedTargetBundle', { name: fileName }));
				break;
			case 'png-bundle':
				state.pngBundle = fullPath;
				state.pngBundleFile = file;
				log(t('bamt.log.selectedBundle', { name: fileName }));
				break;
			case 'png-folder':
				state.pngFolder = fullPath;
				log(t('bamt.log.selectedPngFolder', { name: fileName || fullPath }));
				break;
			default:
				break;
		}
	}

	function bindDropZone(zone) {
		const target = zone.dataset.target;
		zone.addEventListener('dragover', (event) => {
			event.preventDefault();
			zone.classList.add('dragover');
		});
		zone.addEventListener('dragleave', () => {
			zone.classList.remove('dragover');
		});
		zone.addEventListener('drop', (event) => {
			event.preventDefault();
			zone.classList.remove('dragover');
			const files = event.dataTransfer.files;

			if (target === 'game-resource' || target === 'output-dir') {
				updatePathField(target, files);
			} else {
				updateFileSelection(target, files);
			}
		});
	}

	function bindPickerButtons() {
		document.querySelectorAll('.browse-btn').forEach((btn) => {
			const pickerKey = btn.dataset.picker;
			btn.addEventListener('click', () => {
				const input = hiddenInputs[pickerKey];
				if (input) {
					input.click();
				}
			});
		});

		Object.entries(hiddenInputs).forEach(([key, input]) => {
			input.addEventListener('change', () => {
				const files = Array.from(input.files || []);
				if (key === 'game-resource' || key === 'output-dir') {
					updatePathField(key, files);
				} else {
					updateFileSelection(key, files);
				}
			});
		});
	}

	function switchTab(event) {
		const targetTab = event.currentTarget.dataset.tab;
		document.querySelectorAll('.tab-btn').forEach((btn) => {
			btn.classList.toggle('active', btn.dataset.tab === targetTab);
			btn.setAttribute('aria-selected', String(btn.dataset.tab === targetTab));
		});

		document.querySelectorAll('.tab-panel').forEach((panel) => {
			const isActive = panel.dataset.tabPanel === targetTab;
			panel.classList.toggle('active', isActive);
			panel.hidden = !isActive;
		});
	}

	function ensurePath(pathValue, labelKey) {
		const label = t(labelKey);
		if (!pathValue) {
			log(t('bamt.validation.missing', { target: label }), 'warning');
			return false;
		}
		return true;
	}

	function handleOpenFolder(pathValue) {
		if (!ensurePath(pathValue, 'bamt.validation.folder')) {
			return;
		}
		if (shell && typeof shell.openPath === 'function') {
			shell.openPath(pathValue).then((result) => {
				if (result) {
					log(t('bamt.log.openFolderError', { error: result }), 'error');
				} else {
					log(t('bamt.log.openFolderSuccess', { path: pathValue }), 'success');
				}
			});
		} else {
			log(t('bamt.log.openFolderUnsupported'), 'warning');
		}
	}

	async function replaceOriginalFile(type) {
		const lastProcessed = state.lastProcessedFiles[type];
		if (!lastProcessed) {
			log(t('bamt.log.noProcessedFile', { type }), 'warning');
			return;
		}

		const { outputPath, originalPath, processedFileName } = lastProcessed;
		
		if (!outputPath || !originalPath) {
			log(t('bamt.log.replaceOriginalMissingPaths'), 'error');
			return;
		}

		if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
			log(t('bamt.log.electronApiUnavailable'), 'warning');
			return;
		}

		try {
			setStatus(t('bamt.status.replacingOriginal'), 'warning');
			log(t('bamt.log.replaceOriginalStarted', { fileName: processedFileName || 'unknown' }));

			const response = await ipcRenderer.invoke('bamt:replaceOriginal', {
				outputPath,
				originalPath,
				type
			});

			if (!response || !response.ok) {
				throw new Error((response && response.error) || t('bamt.log.genericError'));
			}

			log(t('bamt.log.replaceOriginalComplete', { 
				fileName: processedFileName || 'unknown',
				backup: response.backupPath || 'none'
			}), 'success');
			setStatus(t('bamt.status.idle'), 'idle');
		} catch (error) {
			log(t('bamt.log.replaceOriginalFailed', { error: error.message || String(error) }), 'error');
			setStatus(t('bamt.status.idle'), 'idle');
		}
	}

	async function runModUpdateFlow(triggerButton) {
		const prerequisites = [
			ensurePath(state.oldMod, 'bamt.validation.oldMod'),
			ensurePath(state.newBundle, 'bamt.validation.targetBundle'),
			ensurePath(state.outputDirPath, 'bamt.validation.outputDir'),
		];
		if (!prerequisites.every(Boolean)) {
			setStatus(t('bamt.status.prerequisitesMissing'), 'warning');
			return;
		}
		if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
			log(t('bamt.log.pythonMissing'), 'warning');
			return;
		}
		let oldModPath = state.oldMod;
		let newBundlePath = state.newBundle;
		if (!fileExists(oldModPath)) {
			const oldName = getFileNameFromPath(oldModPath) || oldModPath || '';
			const safeOldName = oldName || t('bamt.common.notSelected');
			log(t('bamt.log.modUpdateAttemptingResolve', { name: safeOldName }), 'warning');
			let resolvedOldMod = await resolveExistingFilePath(oldModPath, [state.outputDirPath]);
			if (!resolvedOldMod && state.oldModFile) {
				const materializedOldMod = await materializeFileSelection(state.oldModFile, { preferredBaseDir: state.outputDirPath });
				if (materializedOldMod && fileExists(materializedOldMod)) {
					resolvedOldMod = materializedOldMod;
					log(t('bamt.log.modUpdateOldModMaterialized', { path: materializedOldMod }), 'success');
				}
			}
			if (resolvedOldMod) {
				state.oldMod = resolvedOldMod;
				oldModPath = resolvedOldMod;
				const resolvedName = getFileNameFromPath(resolvedOldMod) || resolvedOldMod;
				log(t('bamt.log.modUpdateOldModResolved', { name: resolvedName, path: resolvedOldMod }), 'success');
			} else {
				const message = t('bamt.log.modUpdateOldModMissing', { name: safeOldName });
				log(message, 'error');
				setStatus(message, 'error');
				return;
			}
		}
		if (!fileExists(newBundlePath)) {
			const newName = getFileNameFromPath(newBundlePath) || newBundlePath || '';
			const safeNewName = newName || t('bamt.common.notSelected');
			log(t('bamt.log.modUpdateAttemptingResolve', { name: safeNewName }), 'warning');
			let resolvedNewBundle = await resolveExistingFilePath(newBundlePath, [state.gameResourcePath]);
			if (!resolvedNewBundle && state.newBundleFile) {
				const materializedNewBundle = await materializeFileSelection(state.newBundleFile, { preferredBaseDir: state.gameResourcePath });
				if (materializedNewBundle && fileExists(materializedNewBundle)) {
					resolvedNewBundle = materializedNewBundle;
					log(t('bamt.log.modUpdateNewBundleMaterialized', { path: materializedNewBundle }), 'success');
				}
			}
			if (resolvedNewBundle) {
				state.newBundle = resolvedNewBundle;
				newBundlePath = resolvedNewBundle;
				const resolvedName = getFileNameFromPath(resolvedNewBundle) || resolvedNewBundle;
				log(t('bamt.log.modUpdateNewBundleResolved', { name: resolvedName, path: resolvedNewBundle }), 'success');
			} else {
				const message = t('bamt.log.modUpdateNewBundleMissing', { name: safeNewName });
				log(message, 'error');
				setStatus(message, 'error');
				return;
			}
		}
		const payload = {
			oldMod: oldModPath,
			newBundle: newBundlePath,
			outputDir: state.outputDirPath,
			outputName: state.modOutputName,
			replaceTexture: !!options.replaceTexture,
			replaceTextasset: !!options.replaceTextasset,
			replaceMesh: !!options.replaceMesh,
			lang: i18next.language || 'en',
		};
		try {
			if (triggerButton) {
				triggerButton.disabled = true;
			}
			setStatus(t('bamt.status.processing'), 'warning');
			log(t('bamt.log.modUpdateStarted'));
			const response = await ipcRenderer.invoke('bamt:runModUpdate', payload);
			if (!response || !response.ok) {
				throw new Error((response && response.error) || t('bamt.log.genericError'));
			}
			const result = response.result || {};
			const replaced = typeof result.replaced === 'number' ? result.replaced : 0;
			const skipped = typeof result.skipped === 'number' ? result.skipped : 0;
			const outputPath = result.output || state.outputDirPath || '';
			
			// 記錄處理結果，用於覆寫原始檔功能
			state.lastProcessedFiles.modUpdate = {
				outputPath: outputPath,
				originalPath: newBundlePath,
				processedFileName: path ? path.basename(newBundlePath) : null,
				timestamp: new Date(),
			};
			
			log(t('bamt.log.modUpdateComplete', { replaced, skipped, output: outputPath }), 'success');
			if (isUsingDefaultOutputDir()) {
				await notifyModsRefresh();
			}
		} catch (error) {
			log(t('bamt.log.modUpdateFailed', { error: error.message || String(error) }), 'error');
		} finally {
			if (triggerButton) {
				triggerButton.disabled = false;
			}
		}
	}

	async function runPngReplaceFlow(triggerButton) {
		const prerequisites = [
			ensurePath(state.pngBundle, 'bamt.validation.pngBundle'),
			ensurePath(state.pngFolder, 'bamt.validation.pngFolder'),
			ensurePath(state.outputDirPath, 'bamt.validation.outputDir'),
		];
		if (!prerequisites.every(Boolean)) {
			setStatus(t('bamt.status.prerequisitesMissing'), 'warning');
			return;
		}
		if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
			log(t('bamt.log.pythonMissing'), 'warning');
			return;
		}
		const payload = {
			bundle: state.pngBundle,
			pngFolder: state.pngFolder,
			outputDir: state.outputDirPath,
			lang: i18next.language || 'en',
		};
		try {
			if (triggerButton) {
				triggerButton.disabled = true;
			}
			setStatus(t('bamt.status.processing'), 'warning');
			log(t('bamt.log.pngReplaceStarted'));
			const response = await ipcRenderer.invoke('bamt:runPngReplace', payload);
			if (!response || !response.ok) {
				throw new Error((response && response.error) || t('bamt.log.genericError'));
			}
			const result = response.result || {};
			const replaced = typeof result.replaced === 'number' ? result.replaced : 0;
			const outputPath = result.output || state.outputDirPath || '';
			
			// 記錄處理結果，用於覆寫原始檔功能
			state.lastProcessedFiles.pngReplace = {
				outputPath: outputPath,
				originalPath: state.pngBundle,
				processedFileName: path ? path.basename(state.pngBundle) : null,
				timestamp: new Date(),
			};
			
			log(t('bamt.log.pngReplaceComplete', { replaced, output: outputPath }), 'success');
			if (Array.isArray(result.missing) && result.missing.length > 0) {
				log(t('bamt.log.pngReplaceMissing', { list: result.missing.join(', ') }), 'warning');
			}
			if (isUsingDefaultOutputDir()) {
				await notifyModsRefresh();
			}
		} catch (error) {
			log(t('bamt.log.pngReplaceFailed', { error: error.message || String(error) }), 'error');
		} finally {
			if (triggerButton) {
				triggerButton.disabled = false;
			}
		}
	}

	function bindActions() {
		document.querySelectorAll('.tab-btn').forEach((btn) => {
			btn.addEventListener('click', switchTab);
		});

		const runModUpdateBtn = document.getElementById('run-mod-update');
		runModUpdateBtn.addEventListener('click', () => {
			runModUpdateFlow(runModUpdateBtn);
		});

		document.getElementById('replace-original').addEventListener('click', () => {
			replaceOriginalFile('modUpdate');
		});

		document.getElementById('preview-files').addEventListener('click', () => {
			log(
				t('bamt.log.preview', {
					oldMod: state.oldMod || t('bamt.common.notSelected'),
					targetBundle: state.newBundle || t('bamt.common.notSelected'),
					outputName: state.modOutputName || t('bamt.common.notConfigured'),
					options: JSON.stringify(options, null, 2),
				})
			);
		});


		const autoFindBtn = document.getElementById('auto-find-btn');
		autoFindBtn.addEventListener('click', () => {
			void runAutoFind(autoFindBtn);
		});

		document.getElementById('open-output-folder').addEventListener('click', () => {
			handleOpenFolder(state.outputDirPath);
		});

		document.getElementById('open-output-folder-png').addEventListener('click', () => {
			handleOpenFolder(state.outputDirPath);
		});

		const runPngReplaceBtn = document.getElementById('run-png-replace');
		runPngReplaceBtn.addEventListener('click', () => {
			runPngReplaceFlow(runPngReplaceBtn);
		});

		document.getElementById('replace-original-png').addEventListener('click', () => {
			replaceOriginalFile('pngReplace');
		});

		modOutputNameInput.addEventListener('input', (event) => {
			state.modOutputName = event.target.value.trim();
		});

		resetLogBtn.addEventListener('click', clearLog);
	}

	function bindOptions() {
		const optionMap = {
			'opt-replace-texture': 'replaceTexture',
			'opt-replace-textasset': 'replaceTextasset',
			'opt-replace-mesh': 'replaceMesh',
		};

		Object.entries(optionMap).forEach(([checkboxId, optionKey]) => {
			const checkbox = document.getElementById(checkboxId);
			if (!checkbox) return;
			checkbox.checked = options[optionKey];
			checkbox.addEventListener('change', (event) => {
				updateOption(optionKey, event.target.checked);
			});
		});
	}

	function enablePathDropZones() {
		['game-resource', 'output-dir'].forEach((target) => {
			const field = document.querySelector(`[data-field="${target}"] .input-actions input`);
			if (!field) return;
			const parent = field.closest('.field-group');
			parent.addEventListener('dragover', (event) => {
				event.preventDefault();
				parent.classList.add('dragover');
			});
			parent.addEventListener('dragleave', () => {
				parent.classList.remove('dragover');
			});
			parent.addEventListener('drop', (event) => {
				event.preventDefault();
				parent.classList.remove('dragover');
				updatePathField(target, event.dataTransfer.files);
			});
		});
	}

	async function init() {
		document.querySelectorAll('.drop-zone').forEach(bindDropZone);
		bindPickerButtons();
		bindActions();
		bindOptions();
		enablePathDropZones();
		registerGamePathListener();
		registerCliLogListener();
		clearLog();
		await syncGameResourcePath();
		await syncOutputDirPath();
		log(t('bamt.log.interfaceReady'));
		await checkPythonEnvironment();
	}

	window.addEventListener('DOMContentLoaded', async () => {
		try {
			await initializeI18n();
		} catch (error) {
			console.error('Failed to initialize BAMT i18n:', error);
		} finally {
			applyTranslations();
			await init();
		}
	});
})();
