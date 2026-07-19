# AI 上下文分析

为选中的字幕文本提供文化、历史与语言层面的解释。

## 支持的服务商

- OpenAI GPT：GPT-5.6 Luna（推荐）、GPT-5.6 Terra、GPT-5.6
- Google Gemini：Gemini 3.5 Flash（推荐）、Gemini 2.5 Flash、Gemini 2.5 Pro

## 速率限制与缓存

- 默认：60 次/分钟，强制 1 秒延迟
- 缓存：默认 TTL 1 小时，定期清理 + LRU

## 设置

1. 在高级设置启用 AI 上下文分析
2. 选择服务商（OpenAI 或 Gemini），配置 API 密钥与模型
3. 使用自定义 OpenAI 兼容端点时，通过“允许 API 主机”授予 Chrome 对该协议和主机的权限；权限覆盖所有路径和端口

## 使用方法

- 点击字幕单词组成短语，并在 Chrome 侧边栏中查看分析
- 可启用文化、历史、语言分析的任意精确组合
- 关闭“使用侧边栏”后仍可使用旧版弹窗作为回退

## 隐私

- 所选文本、语言信息和有限的周边字幕上下文会发送给已配置的 AI 服务商
- 启用缓存时结果只保存在有界的内存缓存中，DualSub 不会永久保存

参见：`context_providers/openaiContextProvider.js` 与 `context_providers/geminiContextProvider.js`。
