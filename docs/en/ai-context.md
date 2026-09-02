# AI Context Analysis

Get cultural, historical, and linguistic explanations for selected subtitle text.

## Supported Providers

- OpenAI GPT: GPT-5.6 Luna (recommended), GPT-5.6 Terra, GPT-5.6
- Google Gemini: Gemini 3.5 Flash (recommended), Gemini 2.5 Flash, Gemini 2.5 Pro

## Rate Limiting & Caching

- Default: 60 requests/minute with a 1s mandatory delay
- Caching: 1 hour default TTL with automatic cleanup and LRU tracking

## Setup

1. Enable AI Context Analysis in Advanced Settings
2. Choose a provider (OpenAI or Gemini), then set its API key and model
3. For a custom OpenAI-compatible endpoint, use **Allow API host** to grant Chrome access to that scheme and host across all paths and ports

## Usage

- Click subtitle words to build a phrase and open analysis in the Chrome side panel
- Enable any exact combination of Cultural, Historical, and Linguistic analysis
- The legacy modal remains available when **Use Side Panel** is disabled

## Privacy

- Selected text, language metadata, and limited surrounding subtitle context are sent to the configured AI provider
- Results use a bounded in-memory cache when caching is enabled; they are not permanently stored by DualSub

See also: `src/background/aicontext/` for the providers, prompt, and response schemas.
