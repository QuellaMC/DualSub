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
- 后台协议仍为 OpenAI 兼容与 Vertex 服务商保留显式多文本请求；其他服务商会逐条处理该协议。

## 内部速率限制（可能调整）

- Google（免费）：基于字节窗口 + 强制延迟
- Microsoft（免费）：字符滑动窗口（每分钟与每小时）
- DeepL API：按月字符限制
- OpenAI 兼容：每分钟请求数限制 + 小延迟；支持显式多文本请求

当前服务商限制与显式多文本请求路径参见 `background/services/translationService.js`。
