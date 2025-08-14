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

## Option 2: Manual Install (Best for development and testing)

1. Download the source
    - Clone the repository:
        ```bash
        git clone https://github.com/QuellaMC/DualSub.git
        cd DualSub
        ```
    - Or download the ZIP from GitHub and extract it

2. Install dependencies (for running tests/linting during development)

    ```bash
    npm install
    ```

3. Load unpacked extension in Chrome
    - Open `chrome://extensions`
    - Enable Developer mode (top-right toggle)
    - Click Load unpacked and select the project root folder (`DualSub`)

4. Verify it’s working (same as above)
    - Visit Netflix or Disney+
    - Enable subtitles, then click DualSub to enable dual subtitles

5. Update (manual installs)
    - Pull latest changes:
        ```bash
        git pull
        ```
    - Then click the refresh icon on the DualSub card at `chrome://extensions`

---

## Troubleshooting

- Extension not visible: ensure it’s enabled at `chrome://extensions` and optionally pinned in the toolbar
- “Could not load manifest”: make sure you selected the project root folder that contains `manifest.json`
- No subtitles: verify the platform provides subtitles and they are enabled in the player
- AI Context not working: set your API key and model in Advanced Settings; check rate limits and network connectivity
- Provider failures: try switching providers, reduce batch size, or increase request delay in Advanced Settings

If issues persist, please open an issue: [GitHub Issues](https://github.com/QuellaMC/DualSub/issues)
