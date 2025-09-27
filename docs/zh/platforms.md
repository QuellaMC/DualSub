# 支持的平台

| 平台    | 状态     | 关键功能                    |
| ------- | -------- | --------------------------- |
| Netflix | 完全支持 | 官方字幕集成，SPA 导航检测  |
| Disney+ | 完全支持 | M3U8 播放列表解析，视频检测 |
| Hulu    | 完全支持 | TTML/WebVTT 双格式字幕，自动回退 |

## 平台说明

### Netflix

- 增强的 SPA 导航检测
- 优先使用官方字幕轨道

### Disney+

- M3U8 播放列表解析提取字幕
- 支持多种 URL 模式

### Hulu

- 通过 Hulu 播放列表 API 获取字幕（TTML 与 WebVTT）
- 优先 WebVTT，自动回退到 TTML→VTT 转换
- 支持官方字幕优先与语言自动选择

参见：`docs/zh/providers.md` 与 `docs/zh/ai-context.md`。
