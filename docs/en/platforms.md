# Supported Platforms

| Platform | Status       | Key Features                                            |
| -------- | ------------ | ------------------------------------------------------- |
| Netflix  | Full Support | Official subtitle integration, SPA navigation detection |
| Disney+  | Full Support | M3U8 playlist parsing, robust video detection           |
| Hulu     | Full Support | TTML/WebVTT transcripts with robust fallback             |

## Platform-Specific Notes

### Netflix

- Enhanced SPA navigation detection to handle in-app route changes
- Uses official subtitle tracks when available for higher quality

### Disney+

- Advanced M3U8 playlist parsing to extract subtitle tracks
- Supports multiple URL patterns and playback modes

### Hulu

- Uses Hulu playlist API to capture transcripts (TTML and WebVTT)
- Dual format support with fallback: prefers WebVTT, falls back to TTML→VTT conversion
- Robust language selection and official subtitle usage when available

See also: `docs/en/providers.md` for translation provider details and `docs/en/ai-context.md` for AI context analysis.
