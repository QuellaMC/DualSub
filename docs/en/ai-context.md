# AI Context Analysis

Get cultural, historical, and linguistic explanations for selected subtitle text.

## Supported Providers

- OpenAI GPT: GPT-4.1 Mini, GPT-4o, GPT-4o Mini, GPT-4.1 Nano
- Google Gemini: Gemini 2.5 Flash (recommended), Gemini 2.5 Pro, Gemini 1.5 (legacy)

## Rate Limiting & Caching

- Default: 60 requests/minute with a 1s mandatory delay
- Caching: 1 hour default TTL with automatic cleanup and LRU tracking

## Setup

1. Enable AI Context Analysis in Advanced Settings
2. Choose provider (OpenAI or Gemini), set API key and model
3. Use Test Connection to verify

## Usage

- Select text in subtitles to open the context modal
- Choose analysis type: Cultural, Historical, Linguistic, or All

## Privacy

- Only selected text is sent to the AI provider
- Results are cached locally; no permanent storage

See also: `context_providers/openaiContextProvider.js` and `context_providers/geminiContextProvider.js` for technical details.
