# Blue Archive Mod Manager C# - 快速开始指南

## 🎯 5 分钟上手

### 1. 系统要求
- Windows 10 或更新版本
- .NET 10.0 SDK ([下载](https://dotnet.microsoft.com/download))

### 2. 编译应用

```bash
# 进入项目目录
cd "Blue Archive Mod Manager-C#"

# 编译（Debug 模式 - 用于开发）
dotnet build

# 编译（Release 模式 - 用于生产）
dotnet build --configuration Release
```

### 3. 运行应用

#### 方式 1: 使用 dotnet
```bash
cd "Blue Archive Mod Manager-C#"
dotnet run
```

#### 方式 2: 运行可执行文件
```bash
# Debug 版本
"Blue Archive Mod Manager-C#\bin\Debug\net10.0-windows\Blue Archive Mod Manager-C#.exe"

# Release 版本
"Blue Archive Mod Manager-C#\bin\Release\net10.0-windows\Blue Archive Mod Manager-C#.exe"
```

### 4. 首次使用

1. **检测游戏路径**
   - 应用启动时会自动检测游戏
   - 如果自动检测失败，点击"Set Game Path"手动选择 BlueArchive.exe

2. **导入 MOD**
   - 点击"Select File"按钮
   - 选择你的 MOD 文件 (.bundle, .png, .ogg, .mp4 等)
   - MOD 会自动添加到列表

3. **管理 MOD**
   - 勾选复选框启用/禁用 MOD
   - 点击删除按钮可移除 MOD
   - 点击"Select All"快速全选

4. **应用 MOD**
   - 选择要应用的 MOD
   - 点击"Apply Mods"按钮
   - 等待完成提示

5. **启动游戏**
   - 点击"Launch Game"通过 Steam 启动

## 🎨 使用提示

### 主题切换
点击右上角的🌙/☀️按钮切换深色/浅色主题，偏好设置会自动保存。

### 排序 MOD 列表
点击列标题可按该列排序：
- Filename（文件名）
- Character（角色）
- Mod Name（MOD 名称）
- Date（安装日期）

### 自动角色识别
应用会自动识别 MOD 文件中的角色名称，显示在"Character"列。

## 📂 数据存储位置

所有应用数据存储在：
```
C:\Users\<YourUsername>\AppData\Roaming\blue-archive-mod-loader\
```

包括：
- `settings.json` - 应用设置和配置
- `ModBundle/` - 导入的 MOD 文件
- `student-index.json` - 角色索引数据

## 🐛 故障排除

### 问题 1: "找不到游戏"
**解决方案:**
1. 确保已安装 Blue Archive
2. 点击"Set Game Path"手动选择 BlueArchive.exe 的位置
3. 通常位于：`C:\Program Files\Steam\steamapps\common\Blue Archive\BlueArchive.exe`

### 问题 2: MOD 不显示
**解决方案:**
1. 检查 MOD 文件扩展名是否支持
   - 支持的格式: .bundle, .ogg, .mp4, .jpg, .jpeg, .png, .zip, .db
2. 确保文件不是只读的
3. 重启应用

### 问题 3: 应用无法启动
**解决方案:**
1. 确保已安装 .NET 10.0
   ```bash
   dotnet --version
   ```
2. 尝试重新编译
   ```bash
   dotnet clean
   dotnet build
   ```
3. 检查是否有其他 Blue Archive 应用实例在运行

## 🔧 开发者信息

### 项目结构
```
Blue Archive Mod Manager-C#/
├── Models/          # 数据模型
├── Modules/         # 核心业务逻辑
├── Utils/           # 工具类
├── Web/             # 前端资源
└── Form1.cs         # 主窗口
```

### 关键类

**GamePathManager** - 游戏路径检测
```csharp
var gpm = new GamePathManager(settingsManager);
var gamePath = await gpm.FindGameExecutableAsync();
```

**ModManager** - MOD 管理
```csharp
var mm = new ModManager(settingsManager, studentIndexManager);
var mods = mm.GetAllMods();
mm.SelectModFiles(filePaths);
```

**SettingsManager** - 配置管理
```csharp
var sm = new SettingsManager();
sm.Set("key", value);
var value = sm.Get<string>("key", defaultValue);
```

## 📚 了解更多

- [项目完整说明](README.md)
- [迁移完成总结](MIGRATION_COMPLETE.md)
- [原 JavaScript 版本](../Blue%20Archive%20Mod%20Manager-JS/)

## 💡 常见问题

**Q: 为什么应用比 Electron 版本更快？**
A: WebView2 比 Electron 轻量级，内存占用少，启动速度快。

**Q: 能支持 BAMT 吗？**
A: 当前版本不包括 BAMT，但可以在未来版本中添加。

**Q: 导入的 MOD 存储在哪里？**
A: 存储在 AppData 目录的 `ModBundle` 文件夹中，确保下次启动时可以读取。

**Q: 如何备份我的 MOD？**
A: 备份 `AppData\Roaming\blue-archive-mod-loader\` 整个文件夹。

**Q: 可以修改设置文件吗？**
A: 可以，但建议通过应用 UI 修改。设置文件位置：
```
%APPDATA%\blue-archive-mod-loader\settings.json
```

## 🚀 下一步

1. **安装 .NET 10.0** (如未安装)
2. **克隆或下载项目**
3. **运行 `dotnet build`**
4. **启动应用 `dotnet run`**
5. **享受管理 MOD！**

---

**需要帮助?** 查看 README.md 或提交 Issue

**最后更新**: 2025-01-23
