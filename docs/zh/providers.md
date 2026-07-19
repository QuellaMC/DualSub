# 翻译服务商

支持多种服务商，具备自动回退与智能批处理。

## 服务商

- DeepL 免费版：高质量，无需设置；内置请求节流保护
- Google 翻译（免费）：速度快，语言覆盖广
- Microsoft 翻译（免费）：通过 Edge 授权端点，性能稳定
- DeepL API（付费）：最高质量，需要 API 密钥
- OpenAI 兼容（付费）：支持 OpenAI 与 Gemini 兼容端点，需要 API 密钥

## 回退与批处理

- 自动回退：某个服务失败时自动切换到其他服务
- 通用批处理：尽可能合并字幕段以减少 API 调用

## 内部速率限制（可能调整）

- Google（免费）：基于字节窗口 + 强制延迟
- Microsoft（免费）：字符滑动窗口（每分钟与每小时）
- DeepL API：按月字符限制
- DeepL 免费：每小时请求数限制 + 强制延迟
- OpenAI 兼容：每分钟请求数限制 + 小延迟；原生批处理支持

具体阈值与批处理参数参见 `background/services/translationService.js` 与 `background/services/universalBatchProcessor.js`。
