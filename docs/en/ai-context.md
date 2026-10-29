# Word Meanings and AI Explanations

Click a word in the subtitles to see what it means. Nothing needs setting up: the video pauses, and the side panel shows the word in its line, its translation, and a dictionary entry. Click more words, in the subtitles or in the panel's copy of the line, to look up a phrase; click the video to keep watching.

## Where meanings come from

- Translation: the translation service chosen in the settings page's Translation section
- Dictionary: Google's dictionary, or Wiktionary when Google has no entry; Wiktionary's English definitions are translated by your translation service. Each entry names its source.

To stop words from being clickable, turn off **Look up words when I click them** in the settings page's **Meanings** section.

## Explain with AI

**Explain with AI** in the panel asks an AI service how the words are used in their line: what they mean there and how casual or formal they are. **What to explain** adds examples and similar ways to say it, the culture behind the words, and their history and origin.

It works through your own key:

- OpenAI GPT: GPT-5.6 Luna (recommended), GPT-5.6 Terra, GPT-5.6
- Google Gemini: Gemini 3.5 Flash (recommended), Gemini 2.5 Flash, Gemini 2.5 Pro

Without a key, the button opens three steps in the panel: choose a service, get a key from its page, and paste it, then **Check and explain**. The Meanings section has the same steps. Once a key is in, they fold into the name of the service, and **Change key** opens them again.

With advanced options shown, Meanings also sets the model, the limits (by default 60 requests a minute, answers remembered for an hour), and, for a custom OpenAI-compatible endpoint, its address. Use **Allow API host** to grant Chrome access to that scheme and host across all paths and ports.

## While you read

**While I read** chooses whether a click opens the panel and whether the video pauses. **Panel colors** makes the panel light, dark, or match your computer.

## Privacy

- Clicked words go to your translation service and to Google's dictionary, and to Wiktionary when Google has no entry
- Explain with AI sends the words and their subtitle line to your AI service, only when you press it
- Answers are kept in a bounded in-memory cache; DualSub does not store them

See also: `src/background/lookup/` for the dictionary, and `src/background/aicontext/` for the AI providers, prompt, and answer schema.
