# Installation

DualSub runs in Chrome 116 or later and in other Chromium browsers that support Chrome extensions.

## From the Chrome Web Store

1. Open [DualSub in the Chrome Web Store](https://chromewebstore.google.com/detail/dualsub/lnkcpcbpjbidpjdjnmjdllpkgpocaikj) and press **Add to Chrome**.
2. A welcome page opens with your languages already picked. Change the translation language there if you like.
3. Optional: open the puzzle-piece menu in Chrome's toolbar and pin DualSub.

Chrome keeps DualSub up to date. To turn it off or remove it, open `chrome://extensions`.

## From a release ZIP

1. Download the latest `dualsub-v<version>.zip` from [GitHub Releases](https://github.com/QuellaMC/DualSub/releases) and extract it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Press **Load unpacked** and select the extracted folder.

A ZIP install does not update itself. To update, extract the new release over the same folder and press the reload icon on the DualSub card; a different folder installs a second copy with its own settings.

To build DualSub from source, see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Check that it works

Play a video on Netflix or Disney+. Two lines of subtitles appear: the video's language on top and yours underneath. A video already in your language shows one line. The DualSub button in the toolbar turns DualSub off for the site or changes your language.

## Problems

- **"Could not load manifest"**: select the extracted folder that holds `manifest.json`, not the ZIP file.
- **No DualSub button in the toolbar**: check that DualSub is on at `chrome://extensions`, then pin it from the puzzle-piece menu.
- **No subtitles**: play the video (a paused title screen shows none), reload the page, and check that the site's own subtitle menu lists subtitles and that DualSub is on for the site.

The settings page's **Help** section covers these and fixes other common problems, such as subtitles that show twice, in one click.

For problems with word lookup or AI explanations, see [Word meanings and AI explanations](ai-context.md#problems). For a translation service that fails, see [Translation services](providers.md#problems). If a problem stays, [open an issue](https://github.com/QuellaMC/DualSub/issues).
