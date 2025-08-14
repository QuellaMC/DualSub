# AI 上下文分析

为选中的字幕文本提供文化、历史与语言层面的解释。

## 支持的服务商

- OpenAI GPT：GPT-4.1 Mini、GPT-4o、GPT-4o Mini、GPT-4.1 Nano
- Google Gemini：Gemini 2.5 Flash（推荐）、Gemini 2.5 Pro、Gemini 1.5（旧版）

## 速率限制与缓存

- 默认：60 次/分钟，强制 1 秒延迟
- 缓存：默认 TTL 1 小时，定期清理 + LRU

## 设置

1. 在高级设置启用 AI 上下文分析
2. 选择服务商（OpenAI 或 Gemini），配置 API 密钥与模型
3. 使用“测试连接”验证

## 使用方法

- 在字幕中选择文本以打开上下文窗口
- 选择分析类型：文化、历史、语言或综合

## 隐私

- 仅发送所选文本给 AI 服务商
- 结果仅本地缓存，不做永久存储

参见：`context_providers/openaiContextProvider.js` 与 `context_providers/geminiContextProvider.js`。
