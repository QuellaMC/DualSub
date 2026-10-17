# Installation

### Prerequisites

- Google Chrome or Chromium-based browser (latest version recommended)
- Internet connection (for translation providers and word explanations)
- For development only: Node.js 24 LTS and npm 11+

---

## Option 1: Install from Chrome Web Store (Recommended for most users)

1. Open the listing: [Chrome Web Store](https://chromewebstore.google.com/detail/dualsub/lnkcpcbpjbidpjdjnmjdllpkgpocaikj)
2. Click Add to Chrome → Add extension
3. A welcome page opens with your languages already picked; change the language your subtitles are translated into there if you like
4. Pin DualSub (optional): click the puzzle icon in Chrome’s toolbar and pin DualSub for quick access

### Verify

1. Visit Netflix or Disney+
2. Play any video: two lines of subtitles appear, by default the video's language on top and yours underneath; a video already in your language shows one line
3. Click the DualSub icon to turn dual subtitles off or change the languages

### Update

- Automatically handled by the Chrome Web Store
- You can check the installed version at `chrome://extensions` → DualSub

### Uninstall / Disable

- Go to `chrome://extensions`
- Toggle the switch to disable, or click Remove to uninstall

---

## Option 2: Install from GitHub Release (Recommended for manual installation)

1. Download the latest release
    - Go to [GitHub Releases](https://github.com/QuellaMC/DualSub/releases)
    - Download the latest `dualsub-v*.zip` file
    - Extract the ZIP file to a folder

2. Load unpacked extension in Chrome
    - Open `chrome://extensions`
    - Enable Developer mode (top-right toggle)
    - Click Load unpacked and select the extracted folder

3. Verify it's working
    - Visit Netflix or Disney+
    - Enable subtitles, then click DualSub to enable dual subtitles

---

## Option 3: Development Setup (For contributors and developers)

1. Download the source
    - Clone the repository:
        ```bash
        git clone https://github.com/QuellaMC/DualSub.git
        cd DualSub
        ```

2. Install dependencies

    ```bash
    npm ci
    ```

3. Build the extension

    The extension uses React and requires building before use:

    ```bash
    npm run build
    ```

    This will create `dist/chrome-mv3` with the compiled extension.

    For development with auto-rebuild:

    ```bash
    npm run dev
    ```

4. Load unpacked extension in Chrome
    - Open `chrome://extensions`
    - Enable Developer mode (top-right toggle)
    - Click Load unpacked and select **`dist/chrome-mv3`** (not the project root!)

5. Verify it's working
    - Visit Netflix or Disney+
    - Enable subtitles, then click DualSub to enable dual subtitles

6. Development workflow
    - Make changes to source files under `src/`
    - Run `npm run dev` for auto-rebuild on changes
    - Click the refresh icon on the DualSub card at `chrome://extensions` to reload
    - Test your changes

7. Update (development installs)
    - Pull latest changes:
        ```bash
        git pull
        npm ci  # Reinstall exactly from package-lock.json
        npm run build
        ```
    - Then click the refresh icon on the DualSub card at `chrome://extensions`

---

## Troubleshooting

- Extension not visible: ensure it's enabled at `chrome://extensions` and optionally pinned in the toolbar
- "Could not load manifest":
    - For GitHub releases: make sure you extracted the ZIP and selected the extracted folder
    - For development: make sure you selected `dist/chrome-mv3` (not the project root!) and ran `npm run build` first
- Build errors: ensure you have Node.js 24 LTS installed and run `npm ci` before `npm run build`
- No subtitles: verify the platform provides subtitles and they are enabled in the player
- Word explanations not working: in the settings page's Word explanations section, check that the key is in and the feature is on; check the request limit and network connectivity
- Provider failures: the settings page's Translation section names a failing service and the one covering for it; verify the credentials and endpoint, try another service, or raise the pause between translation requests (an advanced option)

If issues persist, please open an issue: [GitHub Issues](https://github.com/QuellaMC/DualSub/issues)
