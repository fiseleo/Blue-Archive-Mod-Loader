# Blue Archive Mod Manager - C# WinForms + WebView2 版本

## 项目说明

这是一个从 Node.js/Electron 版本迁移到 C# WinForms + WebView2 的项目。该应用程序用于管理和应用 Blue Archive 游戏的 MOD。

## 已完成功能

### 后端模块 (C#)

1. **GamePathManager** (`Modules/GamePathManager.cs`)
   - Steam 注册表查询
   - 自动游戏路径检测
   - 驱动器扫描功能
   - 游戏路径保存和读取

2. **StudentIndexManager** (`Modules/StudentIndexManager.cs`)
   - 学生索引数据管理
   - 从文件名提取角色信息
   - 多语言支持

3. **ModManager** (`Modules/ModManager.cs`)
   - MOD 文件选择和导入
   - MOD 数据持久化
   - MOD 启用/禁用管理
   - MOD 文件删除
   - MOD 应用和卸载框架

4. **SettingsManager** (`Utils/SettingsManager.cs`)
   - 应用设置持久化
   - JSON 配置文件管理
   - AppData 目录管理

5. **LocalizationManager** (`Utils/LocalizationManager.cs`)
   - 多语言支持框架
   - JSON 本地化文件加载
   - 动态翻译系统

### 前端

1. **HTML/CSS/JavaScript** (`Web/`)
   - 现代化响应式 UI
   - 深色/浅色主题支持
   - 游戏信息卡片
   - MOD 管理表格
   - 实时交互

2. **WebViewBridge** (`Utils/WebViewBridge.cs`)
   - C# 和 JavaScript 之间的双向通信
   - IPC 处理

### 数据模型

1. **ModData** - MOD 数据结构
2. **GamePathConfig** - 游戏路径配置
3. **StudentCharacterInfo** - 角色信息

## 项目结构

```
Blue Archive Mod Manager-C#/
├── Models/
│   └── ModData.cs              # 数据模型定义
├── Modules/
│   ├── GamePathManager.cs      # 游戏路径管理
│   ├── ModManager.cs           # MOD 管理
│   └── StudentIndexManager.cs  # 角色索引管理
├── Utils/
│   ├── SettingsManager.cs      # 设置管理
│   ├── WebViewBridge.cs        # WebView2 通信桥接
│   └── LocalizationManager.cs  # 国际化管理
├── Web/
│   ├── index.html              # 主页面
│   ├── index.css               # 样式表
│   └── renderer.js             # 前端脚本
├── Form1.cs                    # 主窗口
├── Form1.Designer.cs           # 设计文件
├── Program.cs                  # 入口点
└── Blue Archive Mod Manager-C#.csproj  # 项目文件
```

## 技术栈

- **框架**: .NET 10.0 Windows Forms
- **前端**: HTML5, CSS3, JavaScript (Vanilla)
- **WebView**: Microsoft.Web.WebView2 1.0.3650.58
- **数据格式**: JSON

## 编译和运行

### 先决条件
- .NET 10.0 SDK
- Windows 10 或更高版本
- Visual Studio 2022 或 VS Code

### 编译
```bash
cd "Blue Archive Mod Manager-C#"
dotnet build
```

### 运行
```bash
dotnet run
```

## 核心功能

### 游戏路径检测
1. 首先尝试通过 Steam 注册表查询
2. 如果失败，扫描本地驱动器
3. 支持手动选择游戏路径

### MOD 管理
1. 选择和导入 MOD 文件
2. 显示 MOD 列表（带角色识别）
3. 启用/禁用 MOD
4. 删除 MOD
5. 应用/卸载 MOD（框架已实现）

### 用户界面
- 游戏信息卡片（显示游戏路径）
- MOD 管理表格（可排序）
- 动作面板（应用、卸载、启动游戏）
- 主题切换（深色/浅色）

## 与 JS 版本的差异

### 已迁移
- ✅ 游戏路径检测
- ✅ MOD 文件管理
- ✅ 用户界面（重新设计）
- ✅ 国际化系统框架
- ✅ 设置持久化
- ✅ Steam 集成

### 暂未实现（留给未来）
- ❌ BAMT (BA-Modding-Toolkit) - 按要求不迁移
- ❌ CRC 修补功能
- ❌ 自动更新系统

## 已知问题和注意事项

1. MOD 应用和卸载功能需要实现 CRC 修补逻辑
2. 本地化文件需要手动创建或从 JS 版本复制
3. WebView2 版本不支持 BAMT 集成

## 未来改进

1. 实现 MOD 应用/卸载的完整逻辑（包括 CRC 修补）
2. 支持更多本地化语言
3. 添加自动备份功能
4. 改进错误处理和用户反馈
5. 性能优化和内存管理

## 贡献

欢迎提交 Pull Request 或报告问题！

## 许可证

遵循原项目的许可证。

---

**迁移日期**: 2025-01-23
**迁移状态**: 功能完整 (除 BAMT)
