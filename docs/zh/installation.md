# 安装说明

DualSub 可在 Chrome 116 或更高版本，以及其他支持 Chrome 扩展的 Chromium 浏览器中运行。

## 从 Chrome 应用商店安装

1. 打开 [Chrome 应用商店中的 DualSub](https://chromewebstore.google.com/detail/dualsub/lnkcpcbpjbidpjdjnmjdllpkgpocaikj)，点击 **添加至 Chrome**。
2. 随后会打开欢迎页，语言已经选好。如有需要，可以在那里更改翻译语言。
3. 可选：打开 Chrome 工具栏中的拼图菜单，固定 DualSub。

Chrome 会自动更新 DualSub。要停用或移除它，请打开 `chrome://extensions`。

## 从发布版 ZIP 安装

1. 从 [GitHub Releases](https://github.com/QuellaMC/DualSub/releases) 下载最新的 `dualsub-v<版本号>.zip` 并解压。
2. 打开 `chrome://extensions`，开启 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择解压后的文件夹。

ZIP 安装不会自动更新。更新时，把新版本解压到同一个文件夹，覆盖旧文件，然后点击 DualSub 卡片上的重新加载图标；换一个文件夹会安装第二份 DualSub，设置也各自独立。

如要从源码构建 DualSub，请参阅 [CONTRIBUTING.md](../../CONTRIBUTING.md)（英文）。

## 确认可以使用

在 Netflix 或 Disney+ 上播放视频，会出现两行字幕：上面是视频的语言，下面是你的语言。视频本来就是你的语言时只显示一行。工具栏上的 DualSub 按钮可以为当前网站关闭 DualSub，或更改你的语言。

## 常见问题

- **“无法加载清单”（Could not load manifest）**：选择包含 `manifest.json` 的解压后文件夹，而不是 ZIP 文件。
- **工具栏上没有 DualSub 按钮**：在 `chrome://extensions` 中确认 DualSub 已开启，然后从拼图菜单中固定它。
- **没有字幕**：播放视频（暂停的片头画面不显示字幕），重新加载页面，并确认网站自带的字幕菜单中有字幕、DualSub 在该网站上已开启。

设置页的 **帮助** 部分涵盖以上问题，并能一键解决其他常见问题，例如字幕显示两遍。

查词或 AI 解释的问题，请参阅[查词与 AI 解释](ai-context.md#常见问题)。翻译服务出问题时，请参阅[翻译服务](providers.md#常见问题)。如果问题仍然存在，请[提交 issue](https://github.com/QuellaMC/DualSub/issues)。
