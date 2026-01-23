const { execFile, spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

class PythonManager {
	static resolveAsarPath(targetPath) {
		if (!targetPath) {
			return targetPath;
		}
		const unpackedMarker = 'app.asar.unpacked';
		if (targetPath.includes(unpackedMarker)) {
			return targetPath;
		}
		const asarMarker = 'app.asar';
		const markerIndex = targetPath.indexOf(asarMarker);
		if (markerIndex === -1) {
			return targetPath;
		}
		return targetPath.replace(asarMarker, unpackedMarker);
	}

	constructor(rootDir, { appDataDir } = {}) {
		this.rootDir = rootDir;
		const baseBamtDir = path.join(this.rootDir, 'BAMT');
		this.bamtDir = PythonManager.resolveAsarPath(baseBamtDir);
		this.appDataDir = appDataDir || process.env.APPDATA || path.join(this.rootDir, '.bamt-temp');
		this.venvDir = path.join(this.appDataDir, '.venv');
		this.requirementsPath = path.join(this.bamtDir, 'requirements.txt');
		this.markerPath = path.join(this.appDataDir, '.requirements.hash');
		this.cachedEnvironment = null;
	}

	async detectPython(candidates) {
		const searchList = candidates || [
			{ command: 'python', args: ['--version'] },
			{ command: 'python3', args: ['--version'] },
			{ command: 'py', args: ['-3', '--version'] },
		];

		for (const candidate of searchList) {
			// eslint-disable-next-line no-await-in-loop
			const result = await new Promise((resolve) => {
				execFile(candidate.command, candidate.args, (error, stdout, stderr) => {
					if (error) {
						resolve(null);
						return;
					}
					const output = `${stdout} ${stderr}`.trim();
					resolve({
						installed: true,
						command: candidate.command,
						version: output || null,
					});
				});
			});

			if (result) {
				return result;
			}
		}

		return { installed: false };
	}

	getVenvPythonPath() {
		const scriptsDir = process.platform === 'win32' ? 'Scripts' : 'bin';
		const executable = process.platform === 'win32' ? 'python.exe' : 'python';
		return path.join(this.venvDir, scriptsDir, executable);
	}

	async ensureDirectory(dirPath) {
		await fsp.mkdir(dirPath, { recursive: true });
	}

	async ensureAppDataDir() {
		await this.ensureDirectory(this.appDataDir);
	}

	async createVenv(pythonCommand, log) {
		const pyvenvCfg = path.join(this.venvDir, 'pyvenv.cfg');
		const pythonPath = this.getVenvPythonPath();
		if (fs.existsSync(pyvenvCfg) && fs.existsSync(pythonPath)) {
			log('✅ 已檢測到現有的 Python 虛擬環境 (.venv)。');
			return true;
		}

		log('⚙️ 正在建立 Python 虛擬環境 (.venv)...');
		await this.ensureAppDataDir();
		await this.ensureDirectory(this.venvDir);

		await new Promise((resolve, reject) => {
			execFile(pythonCommand, ['-m', 'venv', this.venvDir], { cwd: this.appDataDir }, (error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});

		if (!fs.existsSync(pythonPath)) {
			throw new Error('虛擬環境建立後仍找不到 python 執行檔。');
		}

		log('✅ 虛擬環境建立完成。');
		return true;
	}

	async computeRequirementsHash() {
		const content = await fsp.readFile(this.requirementsPath, 'utf8');
		return crypto.createHash('sha256').update(content).digest('hex');
	}

	async isRequirementsUpToDate() {
		try {
			const [currentHash, storedHash] = await Promise.all([
				this.computeRequirementsHash(),
				fsp.readFile(this.markerPath, 'utf8'),
			]);
			return currentHash === storedHash.trim();
		} catch (error) {
			return false;
		}
	}

	async writeRequirementsMarker() {
		await this.ensureAppDataDir();
		const currentHash = await this.computeRequirementsHash();
		await fsp.writeFile(this.markerPath, currentHash, 'utf8');
	}

	async installRequirements(pythonPath, log) {
		if (!fs.existsSync(this.requirementsPath)) {
			log('ℹ️ 未找到 requirements.txt，略過套件安裝。');
			return true;
		}

		if (await this.isRequirementsUpToDate()) {
			log('✅ requirements.txt 已是最新狀態，略過安裝。');
			return true;
		}

		log('📦 正在安裝 requirements.txt 內的套件...');

		await new Promise((resolve) => {
			const installer = spawn(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
				cwd: this.appDataDir,
				stdio: 'pipe',
			});

			let stderr = '';
			let stdout = '';

			installer.stdout.on('data', (data) => {
				stdout += data.toString();
			});

			installer.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			installer.on('error', () => {
				log('⚠️ pip 更新時發生錯誤，將繼續使用現有版本。');
				resolve();
			});

			installer.on('close', (code) => {
				if (stdout) {
					log(stdout.trim());
				}
				if (stderr) {
					log(stderr.trim());
				}
				if (code !== 0) {
					log('⚠️ pip 更新失敗，將繼續使用現有版本。');
				}
				resolve();
			});
		});

		await new Promise((resolve, reject) => {
			const installer = spawn(pythonPath, ['-m', 'pip', 'install', '-r', this.requirementsPath], {
				cwd: this.appDataDir,
				stdio: 'pipe',
			});

			let stderr = '';
			let stdout = '';

			installer.stdout.on('data', (data) => {
				stdout += data.toString();
			});

			installer.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			installer.on('error', reject);
			installer.on('close', (code) => {
				if (stdout) {
					log(stdout.trim());
				}
				if (stderr) {
					log(stderr.trim());
				}
				if (code !== 0) {
					reject(new Error(`pip 安裝程序失敗，代碼 ${code}`));
					return;
				}
				resolve();
			});
		});

		await this.writeRequirementsMarker();
		log('✅ 套件安裝完成。');
		return true;
	}

	async ensureEnvironment(log) {
		const logs = [];
		const pushLog = (message) => {
			logs.push(message);
			if (typeof log === 'function') {
				log(message);
			}
		};

		await this.ensureAppDataDir();

		const detection = await this.detectPython();
		if (!detection.installed) {
			this.cachedEnvironment = null;
			pushLog('⚠️ 未找到 Python，請安裝 Python 3.10 以上版本。');
			return { ...detection, logs };
		}

		pushLog(`🐍 偵測到 Python: ${detection.command} ${detection.version || ''}`.trim());

		try {
			await this.createVenv(detection.command, pushLog);
			const pythonPath = this.getVenvPythonPath();
			await this.installRequirements(pythonPath, pushLog);
			const environmentInfo = {
				...detection,
				venvReady: true,
				pythonPath,
				venvPath: this.venvDir,
				logs,
			};
			this.cachedEnvironment = environmentInfo;
			return environmentInfo;
		} catch (error) {
			this.cachedEnvironment = null;
			pushLog(`❌ 建立虛擬環境或安裝套件時發生錯誤: ${error.message}`);
			return {
				...detection,
				venvReady: false,
				pythonPath: null,
				venvPath: this.venvDir,
				logs,
				error: error.message,
			};
		}
	}

	getCliPath() {
		return path.join(this.bamtDir, 'cli.py');
	}

	async runCli(subcommand, args = [], logCallback, options = {}) {
		const logs = [];
		const forwardLog = (message, level = 'info') => {
			const entry = { message, level };
			logs.push(entry);
			if (typeof logCallback === 'function') {
				logCallback(entry);
			}
		};

		const envInfo = await this.ensureEnvironment((msg) => forwardLog(msg));
		if (!envInfo.installed) {
			throw new Error('未安裝 Python，無法執行 BAMT CLI。');
		}
		if (!envInfo.venvReady || !envInfo.pythonPath) {
			throw new Error('Python 虛擬環境未就緒，請查看日誌。');
		}

		const cliPath = this.getCliPath();
		if (!fs.existsSync(cliPath)) {
			throw new Error('找不到 BAMT CLI 腳本 (cli.py)。');
		}

		const pythonArgs = [cliPath];
		if (options && options.lang) {
			pythonArgs.push('--lang', options.lang);
		}
		pythonArgs.push(subcommand, ...args);
		const envVars = { ...process.env, PYTHONUTF8: '1' };
		const spawnOptions = {
			cwd: this.bamtDir,
			env: envVars,
		};

		return await new Promise((resolve, reject) => {
			const child = spawn(envInfo.pythonPath, pythonArgs, spawnOptions);
			let stdoutBuffer = '';
			let stderrBuffer = '';
			let resultPayload = null;

			const flushLine = (line) => {
				if (!line) {
					return;
				}
				if (line.startsWith('LOG:')) {
					const content = line.slice('LOG:'.length);
					const splitIndex = content.indexOf(':');
					let level = 'info';
					let message = content;
					if (splitIndex !== -1) {
						level = content.slice(0, splitIndex) || 'info';
						message = content.slice(splitIndex + 1).trim();
					}
					forwardLog(message, level);
					return;
				}
				if (line.startsWith('RESULT:')) {
					const payload = line.slice('RESULT:'.length);
					try {
						resultPayload = JSON.parse(payload);
					} catch (jsonError) {
						forwardLog(`無法解析 CLI 回傳資料: ${jsonError.message}`, 'error');
					}
					return;
				}
				forwardLog(line);
			};

			child.stdout.on('data', (data) => {
				stdoutBuffer += data.toString('utf8');
				let newlineIndex = stdoutBuffer.indexOf('\n');
				while (newlineIndex !== -1) {
					const line = stdoutBuffer.slice(0, newlineIndex).trim();
					flushLine(line);
					stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
					newlineIndex = stdoutBuffer.indexOf('\n');
				}
			});

			child.stderr.on('data', (data) => {
				const text = data.toString('utf8');
				stderrBuffer += text;
				text.split(/\r?\n/).forEach((line) => {
					if (line.trim()) {
						forwardLog(line.trim(), 'error');
					}
				});
			});

			child.on('error', (error) => {
				reject(error);
			});

			child.on('close', (code) => {
				if (stdoutBuffer.trim()) {
					flushLine(stdoutBuffer.trim());
				}
				if (code === 0 && resultPayload) {
					resolve({ ...resultPayload, logs });
					return;
				}
				if (code === 0) {
					resolve({ status: 'success', logs });
					return;
				}
				const errorMessage = resultPayload && resultPayload.message
					? resultPayload.message
					: stderrBuffer.trim() || `CLI exited with code ${code}`;
				reject(new Error(errorMessage));
			});
		});
	}
}

module.exports = PythonManager;
