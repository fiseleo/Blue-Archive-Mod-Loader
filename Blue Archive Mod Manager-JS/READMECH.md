# Blue Archive Mod Loader

一個簡易的 Blue Archive Mod 管理器，支援多語言（繁體中文/英文）、Steam 啟動、Mod 檔案管理與自動/手動遊戲路徑偵測。

## 功能
- 多語言介面（i18n，支援 zh-TW/en）
- 一鍵啟動 Blue Archive（Steam 版）
- Mod 檔案拖曳/選擇、啟用/停用、刪除
- 自動偵測遊戲路徑，亦可手動指定

![alt text](image.png)


## 如何開發

### 1. 安裝依賴
```bash
npm install
```

### 2. 開發模式啟動
```bash
npm start
```

## 安裝

[Releases](https://github.com/fiseleo/Blue-Archive-Mod-Loader/releases)


## 使用說明
1. 啟動程式後，會自動偵測遊戲路徑，找不到時可手動指定。
2. 點選「選擇Mod檔案」可加入 .bundle 檔案，支援多選。
3. 可啟用/停用/刪除 Mod，並套用或還原。
4. 點「啟動遊戲」可直接用 Steam 啟動。

## 注意事項
- ModBundle 目錄僅會建立於 `%APPDATA%/Blue-Archive-Mod-Loader/ModBundle`，請勿手動移動。

## 開發/貢獻
- 主要程式碼：`main.js`、`renderer.js`、`preload.js`
- 語言檔：`locales/zh-TW/translation.json`、`locales/en/translation.json`
- UI：`index.html`

### BAMT Python 後端

BAMT（BA-Modding-Toolkit）視窗會透過精簡的 Python CLI 來進行 Bundle-to-Bundle 與
PNG 替換流程。當偵測到 Python 3.10 以上版本時，程式會自動：

- 在 `%APPDATA%\blue-archive-mod-loader\.venv` 建立虛擬環境
- 從 `BAMT/requirements.txt` 安裝必要套件（UnityPy、Pillow）
- 透過該虛擬環境執行 `BAMT/cli.py`

若要手動測試 CLI，可直接執行：

```powershell
$env:APPDATA\blue-archive-mod-loader\.venv\Scripts\python.exe BAMT\cli.py --help
```

目前 CLI 僅進行檔案替換，不包含 CRC 修正。

---

如有建議或問題，歡迎提出！
[Discord](https://discord.gg/nQ4rg4K8QE)
