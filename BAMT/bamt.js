(() => {
	const i18next = window.i18next;
	if (!i18next) {
		throw new Error('i18next global is unavailable. Ensure i18next.min.js is loaded before bamt.js.');
	}

	let shell = null;
	let ipcRenderer = null;
	let path = null;

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

	const state = {
		gameResourcePath: '',
		outputDirPath: '',
		oldMod: null,
		newBundle: null,
		modOutputName: '',
		pngBundle: null,
		pngFolder: null,
		defaultOutputDir: '',
	};

	const options = {
		enablePadding: false,
		createBackup: true,
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
		enablePadding: 'bamt.options.enablePadding',
		createBackup: 'bamt.options.createBackup',
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
				autoFindPrefixInput.value = extractAutoPrefix(fileName);
				log(t('bamt.log.selectedOldMod', { name: fileName }));
				break;
			case 'new-bundle':
				state.newBundle = fullPath;
				if (!modOutputNameInput.value.trim()) {
					modOutputNameInput.value = fileName;
					state.modOutputName = fileName;
				}
				log(t('bamt.log.selectedTargetBundle', { name: fileName }));
				break;
			case 'png-bundle':
				state.pngBundle = fullPath;
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
		const payload = {
			oldMod: state.oldMod,
			newBundle: state.newBundle,
			outputDir: state.outputDirPath,
			outputName: state.modOutputName,
			enablePadding: !!options.enablePadding,
			createBackup: !!options.createBackup,
			replaceTexture: !!options.replaceTexture,
			replaceTextasset: !!options.replaceTextasset,
			replaceMesh: !!options.replaceMesh,
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
			enablePadding: !!options.enablePadding,
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
			log(t('bamt.log.replaceOriginalUnavailable'), 'warning');
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

		document.getElementById('auto-find-btn').addEventListener('click', () => {
			const ready = ensurePath(state.oldMod, 'bamt.validation.oldMod') && ensurePath(state.gameResourcePath, 'bamt.validation.gameResource');
			if (!ready) {
				return;
			}
			log(t('bamt.log.autoFindUnavailable'), 'warning');
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
			log(t('bamt.log.replaceOriginalUnavailable'), 'warning');
		});

		modOutputNameInput.addEventListener('input', (event) => {
			state.modOutputName = event.target.value.trim();
		});

		resetLogBtn.addEventListener('click', clearLog);
	}

	function bindOptions() {
		const optionMap = {
			'opt-enable-padding': 'enablePadding',
			'opt-create-backup': 'createBackup',
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
