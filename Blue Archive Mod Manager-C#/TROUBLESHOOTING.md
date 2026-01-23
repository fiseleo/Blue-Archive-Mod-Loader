# Blue Archive Mod Manager - 故障排查指南

## 常见问题和解决方案

### ❌ 问题 1: "index.html not found" 错误

**原因**: Web 文件没有被正确复制到编译输出目录。

**解决方案**:

#### 方法 1: 确保编译正确
```bash
cd "Blue Archive Mod Manager-C#"
dotnet clean
dotnet build
```

#### 方法 2: 手动验证 Web 文件
```bash
# 检查 Web 文件是否在输出目录
dir "bin\Debug\net10.0-windows\Web\"

# 应该显示：
# - index.html
# - index.css  
# - renderer.js
```

#### 方法 3: 项目文件配置
确保 `.csproj` 文件包含以下内容：
```xml
<ItemGroup>
  <Content Include="Web\**\*" CopyToOutputDirectory="PreserveNewest" />
</ItemGroup>
```

---

### ❌ 问题 2: WebView2 Runtime 错误

**原因**: 未安装 WebView2 Runtime。

**解决方案**:

1. 下载 WebView2 Runtime:
   - 访问: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
   - 选择 "Evergreen Runtime"

2. 安装完成后重启应用

---

### ❌ 问题 3: 游戏路径无法自动检测

**原因**: Steam 未安装或游戏不在标准位置。

**解决方案**:

1. 点击 "Set Game Path" 按钮
2. 手动选择 `BlueArchive.exe` 文件
3. 通常位置:
   ```
   C:\Program Files\Steam\steamapps\common\Blue Archive\BlueArchive.exe
   ```

---

### ❌ 问题 4: MOD 无法加载

**原因**: 文件类型不支持或权限问题。

**解决方案**:

1. **检查文件类型**
   - 支持的格式: `.bundle`, `.ogg`, `.mp4`, `.jpg`, `.jpeg`, `.png`, `.zip`, `.db`
   - 如果文件格式不对，请确认 MOD 文件格式

2. **检查文件权限**
   - 确保文件不是只读的
   - 右键 → 属性 → 取消"只读"复选框

3. **检查 ModBundle 目录权限**
   ```
   %APPDATA%\Roaming\blue-archive-mod-loader\ModBundle\
   ```

---

### ❌ 问题 5: 应用闪退

**原因**: 初始化错误。

**解决方案**:

1. **从命令行运行以查看错误**:
   ```bash
   cd "Blue Archive Mod Manager-C#"
   dotnet run
   ```

2. **检查错误消息**并查看本指南

3. **清理和重建**:
   ```bash
   dotnet clean
   dotnet build
   ```

---

### ❌ 问题 6: 设置无法保存

**原因**: AppData 目录权限问题。

**解决方案**:

1. 确保有写入权限到:
   ```
   %APPDATA%\Roaming\blue-archive-mod-loader\
   ```

2. 手动创建目录 (如果不存在):
   ```bash
   mkdir "%APPDATA%\Roaming\blue-archive-mod-loader"
   ```

3. 检查磁盘空间是否充足

---

## ✅ 验证清单

在运行应用前，请确保：

- [ ] .NET 10.0 SDK 已安装
  ```bash
  dotnet --version
  ```

- [ ] WebView2 Runtime 已安装
  - 访问: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

- [ ] 项目编译成功
  ```bash
  dotnet build
  ```

- [ ] Web 文件存在于输出目录
  ```bash
  dir "bin\Debug\net10.0-windows\Web\"
  ```

- [ ] 有足够的磁盘空间

- [ ] Windows 10 或更新版本

---

## 🔍 调试建议

### 启用详细日志

修改 `Form1.cs` 中的 `InitializeWebView()` 方法来输出更多调试信息：

```csharp
Console.WriteLine($"Base Directory: {AppDomain.CurrentDomain.BaseDirectory}");
Console.WriteLine($"HTML Path: {htmlPath}");
Console.WriteLine($"File Exists: {File.Exists(htmlPath)}");
```

### 检查浏览器开发者工具

WebView2 支持开发者工具。按 F12 打开：

1. 检查 Console 选项卡中是否有 JavaScript 错误
2. 使用 Network 选项卡检查资源加载
3. 查看 Application 选项卡中的 LocalStorage

### 使用事件查看器

1. 打开 Windows 事件查看器
2. 查看 "Windows Logs" → "Application"
3. 搜索应用相关的错误信息

---

## 📞 获取更多帮助

如果以上解决方案都不起作用：

1. 检查 [README.md](README.md) 了解更多信息
2. 查看 [项目完成总结](MIGRATION_COMPLETE.md)
3. 提交 Issue 到 GitHub: https://github.com/fiseleo/Blue-Archive-Mod-Loader

---

## 💡 性能优化建议

如果应用运行缓慢：

1. **禁用不必要的功能**
   - 如果不使用 Steam，手动设置游戏路径

2. **清理 MOD 列表**
   - 删除不需要的 MOD

3. **清理应用数据**
   ```bash
   rm -r "%APPDATA%\Roaming\blue-archive-mod-loader\"
   ```

4. **更新驱动程序**
   - 更新图形驱动程序以改进 WebView2 性能

---

**最后更新**: 2025-01-23
