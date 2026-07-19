# 翻译服务商

支持多种翻译服务商，并针对不同服务商执行速率限制。

## 服务商

- Google 翻译（免密钥）：语言覆盖广的尽力而为消费端点
- Microsoft 翻译（免密钥）：尽力而为的 Edge 翻译端点
- DeepL API（Free/Pro）：使用受支持的 DeepL API，需要 API 密钥
- OpenAI 兼容：支持用户配置的 OpenAI 兼容端点，需要 API 密钥
- Vertex AI Gemini：使用 Google Cloud 项目与短期访问令牌

免密钥的 Google/Microsoft 集成使用未公开的消费级/内部端点，可能随时变化。若需要有文档保障的服务契约，请使用受支持的密钥服务商。

## 请求处理

- 内容脚本会逐条翻译字幕。
- 当前后台翻译契约对所有服务商均为每次请求仅接受一段文本。

## 请求间隔与工作进程本地保护（可能调整）

- Google（免费）：基于字节窗口 + 强制延迟
- Microsoft（免费）：仅当前后台工作进程的一分钟字符保护与强制延迟；不代表持久化的 Microsoft 账户配额
- DeepL API：仅在本地执行请求间隔；配额以 DeepL 服务端响应为准
- OpenAI 兼容：每分钟请求数限制 + 小延迟

当前服务商限制与单文本请求路径参见 `background/services/translationService.js`。
