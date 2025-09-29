# Blue Archive Mod Loader

A simple Blue Archive Mod manager supporting multi-language (Traditional Chinese/English), Steam launch, mod file management, and automatic/manual game path detection.

## Features
- Multi-language interface (i18n, supports zh-TW/en)
- One-click launch for Blue Archive (Steam version)
- Drag & drop/select mod files, enable/disable, delete
- Auto-detect game path, manual selection also available

![alt text](image.png)

## Development

### 1. Install dependencies
```bash
npm install
```

### 2. Start in development mode
```bash
npm start
```

## Installation

[Releases](https://github.com/fiseleo/Blue-Archive-Mod-Loader/releases)

## Usage
1. After launching, the app will auto-detect the game path. If not found, you can set it manually.
2. Click "Select Mod File" to add .bundle files (multi-select supported).
3. You can enable/disable/delete mods, and apply or restore them.
4. Click "Launch Game" to start Blue Archive via Steam.

## Notes
- The ModBundle directory is only created at `%APPDATA%/Blue-Archive-Mod-Loader/ModBundle`. Do not move it manually.

## Development/Contribution
- Main code: `main.js`, `renderer.js`, `preload.js`
- Language files: `locales/zh-TW/translation.json`, `locales/en/translation.json`
- UI: `index.html`

### BAMT Python backend

The bundled BA-Modding-Toolkit (BAMT) window uses a lightweight Python CLI to perform
bundle-to-bundle and PNG replacement tasks. When Python 3.10+ is detected, the app automatically:

- Creates a virtual environment under `%APPDATA%\blue-archive-mod-loader\.venv`
- Installs dependencies from `BAMT/requirements.txt` (UnityPy, Pillow)
- Executes `BAMT/cli.py` through that virtual environment

You can also run the CLI manually for testing:

```powershell
$env:APPDATA\blue-archive-mod-loader\.venv\Scripts\python.exe BAMT\cli.py --help
```

Both `mod-update` and `png-replace` subcommands intentionally skip CRC correction to match the
Electron workflow.



[中文版](READMECH.md)

---

If you have suggestions or questions, feel free to ask!
[Discord](https://discord.gg/nQ4rg4K8QE)

