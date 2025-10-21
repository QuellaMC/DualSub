# Installation

### Prerequisites

- Google Chrome or Chromium-based browser (latest version recommended)
- Internet connection (for translation providers and AI Context)
- For development only: Node.js 18+ and npm

---

## Option 1: Install from Chrome Web Store (Recommended for most users)

1. Open the listing: [Chrome Web Store](https://chromewebstore.google.com/detail/dualsub/lnkcpcbpjbidpjdjnmjdllpkgpocaikj)
2. Click Add to Chrome → Add extension
3. Pin DualSub (optional): click the puzzle icon in Chrome’s toolbar and pin DualSub for quick access

### Verify

1. Visit Netflix or Disney+
2. Start playing any video and enable subtitles
3. Click the DualSub icon → enable Dual Subtitles and choose target language

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
    npm install
    ```

3. Build the extension

    The extension uses React and requires building before use:

    ```bash
    npm run build
    ```

    This will create a `dist/` folder with the compiled extension.

    For development with auto-rebuild:

    ```bash
    npm run dev
    ```

4. Load unpacked extension in Chrome
    - Open `chrome://extensions`
    - Enable Developer mode (top-right toggle)
    - Click Load unpacked and select the **`dist/`** folder (not the project root!)

5. Verify it's working
    - Visit Netflix or Disney+
    - Enable subtitles, then click DualSub to enable dual subtitles

6. Development workflow
    - Make changes to source files in `popup/`, `options/`, etc.
    - Run `npm run dev` for auto-rebuild on changes
    - Click the refresh icon on the DualSub card at `chrome://extensions` to reload
    - Test your changes

7. Update (development installs)
    - Pull latest changes:
        ```bash
        git pull
        npm install  # In case dependencies changed
        npm run build
        ```
    - Then click the refresh icon on the DualSub card at `chrome://extensions`

---

## Troubleshooting

- Extension not visible: ensure it's enabled at `chrome://extensions` and optionally pinned in the toolbar
- "Could not load manifest":
    - For GitHub releases: make sure you extracted the ZIP and selected the extracted folder
    - For development: make sure you selected the `dist/` folder (not the project root!) and ran `npm run build` first
- Build errors: ensure you have Node.js 18+ installed and run `npm install` before `npm run build`
- No subtitles: verify the platform provides subtitles and they are enabled in the player
- AI Context not working: set your API key and model in Advanced Settings; check rate limits and network connectivity
- Provider failures: try switching providers, reduce batch size, or increase request delay in Advanced Settings

If issues persist, please open an issue: [GitHub Issues](https://github.com/QuellaMC/DualSub/issues)
