# Word meanings and AI explanations

Click a word in the subtitles to see what it means; nothing needs setting up. The video pauses, and the side panel shows the line, the word's translation, and a dictionary entry. To look up a phrase, click more words in the subtitles or in the panel's copy of the line, and click a picked word in the panel to take it out. Click the video to keep watching.

## Where meanings come from

- The translation comes from your [translation service](providers.md).
- The dictionary entry comes from Google's dictionary, or from Wiktionary when Google has no entry or does not answer. Wiktionary's definitions are in English, and your translation service translates them. Each entry names its source.

To make subtitle words unclickable, turn off **Look up words when I click them** in the settings page's **Meanings** section.

## Explain with AI

**Explain with AI** in the panel asks an AI service how the words are used in their line: what they mean there, and how casual or formal they are. **What to explain** in Meanings adds more, and all of it is on by default:

- **Meaning, and how to use it**: examples and similar ways to say it
- **The culture behind it**
- **History and origin**

It needs your own key for one of these services:

- OpenAI: GPT-5.6 Luna (the default), GPT-5.6 Terra, or GPT-5.6
- Google Gemini: Gemini 3.5 Flash (the default), Gemini 2.5 Flash, or Gemini 2.5 Pro

Without a key, the button opens three steps in the panel: choose a service, get a key from its page, and paste it, then press **Check and explain**. Meanings has the same steps. Once a key is in, the steps fold into the service's name, and **Change key** opens them again.

With advanced options shown, Meanings also sets the model (for OpenAI, any model name), the limits (by default 60 requests a minute, with answers remembered for an hour), and the address of another OpenAI-compatible server. For such an address, press **Allow API host** to let DualSub reach it; the permission covers every path and port on that host.

## While you read

**While I read** sets whether a click opens the panel and whether the video pauses. **Panel colors** makes the panel light, dark, or match your computer.

## Privacy

- The words you click go to your translation service and to Google's dictionary, and to Wiktionary when Google has no entry or does not answer.
- **Explain with AI** sends the words and their line to your AI service, and only when you press it.
- Answers stay in memory for a limited time; DualSub does not save them.

The [privacy policy](../../PRIVACY_POLICY.md) lists everything DualSub sends and where.

## Problems

- **Words can't be clicked**: turn on **Look up words when I click them** in Meanings.
- **"No entry for this word on its own"**: click the words around it to look up the whole phrase.
- **"That key didn't work"**: check the key or get a new one, then press **Check and explain**.
- **"The AI service didn't answer"**: press **Try again**. With advanced options shown, check **Most requests per minute** in Meanings.
