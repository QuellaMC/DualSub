# Contributing to DualSub

This page covers reporting issues, building DualSub from source, and what a pull request needs.

## Reporting issues

Search the [open issues](https://github.com/QuellaMC/DualSub/issues) first, and file one issue per problem. The issue templates ask for what it takes to reproduce a problem. For a bug, attach the diagnostic report: in the settings page, turn on **Advanced options** in the top bar, open **Advanced**, and press **Copy report**. The report contains no keys.

## Getting started

You need Node.js 24.5 or later, npm 11 or later, and Chrome 116 or later.

```bash
git clone https://github.com/QuellaMC/DualSub.git
cd DualSub
npm ci
npm run dev
```

`npm run dev` writes a development build to `dist/chrome-mv3-dev`, opens Chrome with it loaded, and reloads it as you edit.

To try the production build, run `npm run build`, open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked**, and select `dist/chrome-mv3`. Press the reload icon on the DualSub card after each build.

## Commands

```bash
npm run compile         # type-check
npm run lint            # ESLint, no warnings allowed; lint:fix fixes what it can
npm run format:check    # Prettier; format rewrites the files
npm test                # Vitest once; test:watch reruns on change
npm test -- src/config  # one directory or file
npm run test:coverage   # tests with the coverage floors CI enforces
npm run build           # production build in dist/chrome-mv3
npm run zip             # release archive in dist/
npm run verify:release  # audit the release archive
```

CI runs `compile`, `lint`, `format:check`, `test:coverage`, `build`, `zip`, and `verify:release` on every pull request.

## How the code fits together

DualSub is a Manifest V3 extension written in strict TypeScript with [WXT](https://wxt.dev), React 19, zod, and Vitest. `wxt.config.ts` declares the manifest, and `src/build/manifest.golden.json` pins it: a test fails when the two differ.

| Path               | What it holds                                                                       |
| ------------------ | ----------------------------------------------------------------------------------- |
| `src/entrypoints/` | The service worker, content scripts, popup, settings page, side panel, welcome page |
| `src/background/`  | Subtitle fetching, translation, word lookup, AI explanations, side panel state      |
| `src/content/`     | The page bridge, player sessions, subtitle rendering, word selection, site adapters |
| `src/messaging/`   | Message contracts, the router, sender checks                                        |
| `src/config/`      | The settings schema, storage, migrations                                            |
| `src/ui/`          | The React popup, settings page, side panel, and welcome page                        |
| `src/shared/`      | Code every context uses: logging, fetch hardening, provider and site lists          |
| `public/_locales/` | The UI text, one catalog per language; a test keeps them in step                    |

A few rules hold the design together:

- Each video gets one player session. Its listeners, timers, and requests share one abort signal and end together.
- A main-world script per site, declared in the manifest, reads subtitle tracks, the audio language, and the profile's subtitle appearance from the site's own player. It passes them to the content script over a `MessageChannel`. Netflix tracks come from the player API; Disney+ tracks come from HLS (M3U8) playlists.
- Every cross-context message is a zod contract. The router authenticates the sender and checks its role before a typed handler sees the payload.
- The content script owns the word selection; the side panel shows it and asks for changes.
- Subtitle files are fetched only from an allowlist of site CDNs, with size caps. Provider requests carry no browser cookies.

## Adding a translation service

1. Implement `TranslationProvider` (`src/background/translation/provider.ts`) in a module under `src/background/translation/providers/`, and register it in `providers/index.ts`.
2. Add its id to `PROVIDER_IDS` and its credentials to `PROVIDER_CREDENTIALS` in `src/shared/providers.ts`, and its settings to `src/config/schema.ts`.
3. Add its name to `src/ui/providerNames.ts`, its setup card under `src/ui/options/providers/`, and its text to every catalog in `public/_locales/`.
4. Add its host to `wxt.config.ts` and `src/build/manifest.golden.json`, and say why in the commit.
5. Add tests next to each module.

## Adding a streaming site

1. Add the site to `src/shared/platforms.ts` and to sender classification in `src/messaging/sender.ts`, and add a descriptor and adapter under `src/content/platform/`.
2. Add its content script and main-world script to `src/entrypoints/`, its recipe to `src/content/bridge/main-world/`, and its messages to `src/content/bridge/protocol.ts`.
3. Extend the subtitle policy and parsers in `src/background/subtitle/` for its CDN.
4. Add its hosts to `wxt.config.ts` and `src/build/manifest.golden.json`, and say why in the commit.
5. Run the [smoke protocol](docs/reference/smoke-protocol.md) on the site.

## Pull requests

- Title commits and pull requests in [Conventional Commits](https://www.conventionalcommits.org/) form, such as `fix: keep the panel open across tabs`.
- Add a test for each behavior you change.
- Update the user docs in `docs/en/` and `docs/zh/` together, and the [privacy policy](PRIVACY_POLICY.md) and [store review notes](docs/reference/store-review-notes.md) when a permission or data flow changes.
- Describe user-facing changes under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
- Do not reintroduce a defect class listed in the [audit report](docs/reference/pr62-audit-report.html).

## Releases

A merge to `main` that raises the version in `package.json` publishes a GitHub release. The release workflow takes its notes from that version's section in `CHANGELOG.md` and fails if there is none. Run the [smoke protocol](docs/reference/smoke-protocol.md) on Netflix and Disney+ before you raise the version.
