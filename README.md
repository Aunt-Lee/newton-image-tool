# Newton Image Tool

一个本地网页工具，用于通过中转站 API 快捷调用 `gpt-image-2`。

## 功能

- 默认 Base URL：`https://newtonrouter.com`，可在页面里修改。
- 两种调用方式：`/v1/images/generations` 和流式 `/v1/chat/completions`。
- 分辨率选项：`1K`、`2K`、`4K`，默认 `1K`。
- 可选择图片保存目录，生成后自动保存并在网页预览。
- 提供 macOS 和 Windows 启动脚本。

## 使用方式

## 给用户分发

推荐直接把整个项目文件夹打成 zip 给用户下载。用户解压后：

- macOS：双击 `Start Newton Image Tool.command`
- Windows：双击 `Start Newton Image Tool.bat`

注意：当前版本依赖 Node.js 18 或更高版本。如果用户电脑没有 Node.js，需要先安装再运行。

### macOS

双击 `Start Newton Image Tool.command`。如果系统提示不能打开，可在终端里执行：

```bash
chmod +x "Start Newton Image Tool.command"
```

### Windows

双击 `Start Newton Image Tool.bat`。

### 通用方式

安装 Node.js 18 或更高版本后，在本目录运行：

```bash
npm start
```

启动后会自动打开本地网页。默认地址通常是：

```text
http://127.0.0.1:31876
```

## 高级 JSON

页面里的“高级 JSON”会合并进请求体，适合中转站需要额外字段时使用。例如：

```json
{
  "quality": "high"
}
```

如果需要额外请求头：

```json
{
  "headers": {
    "X-Custom-Header": "value"
  }
}
```

## 说明

工具不会把 API Key 写入项目文件；浏览器会把你填写过的值保存在本机 `localStorage`，便于下次打开继续使用。
