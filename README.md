# Newton Image Tool

用于本地生成与保存图片的轻量工具。

## 功能

- 默认服务地址：`https://newtonrouter.com`。
- 支持标准模式和实时返回两种生成方式。
- 分辨率选项：`1K`、`2K`、`4K`，默认 `1K`。
- 可选择图片保存目录，生成后自动保存并在页面预览。
- 提供 macOS 和 Windows 启动脚本。

## 使用方式

### macOS

双击 `Start Newton Image Tool.command`。如果系统提示不能打开，可在终端里执行：

```bash
chmod +x "Start Newton Image Tool.command"
```

### Windows

双击 `Start Newton Image Tool.bat`。

### 通用方式

安装 Node.js 18 或更高版本后，在项目目录运行：

```bash
npm start
```

启动后会自动打开本地网页。默认地址通常是：

```text
http://127.0.0.1:31876
```

## 高级参数

页面中的高级参数会合并进请求体，适合需要补充额外字段时使用。例如：

```json
{
  "quality": "high"
}
```

如需附加请求头：

```json
{
  "headers": {
    "X-Custom-Header": "value"
  }
}
```

## 说明

工具不会把 API 密钥写入项目文件；浏览器会将你填写的内容保存在本机 `localStorage`，方便下次继续使用。
