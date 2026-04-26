# Bookmark Curator

Bookmark Curator is a Chrome Manifest V3 extension for backing up, checking, and reorganizing large bookmark collections with a local OpenAI-compatible model endpoint.

## Features

- Full bookmark JSON backup before organization runs
- Polite link checks with browser `fetch` (`HEAD`, then short `GET` fallback)
- Duplicate detection by normalized URL
- AI-generated organization plans using `http://localhost:8317/v1`
- Broken-link-only cleanup mode that does not call AI
- Organization modes for existing folders, hybrid cleanup, or a fresh taxonomy under `Bookmark Curator / Fresh Taxonomy`
- Review-before-apply workflow
- Resumable scans with saved per-bookmark link-check progress
- Single interrupted-run checkpoint with pause, resume, and retry controls
- Undo for the last applied move run
- Safe empty-folder cleanup after applying a plan
- Side panel progress dashboard
- Options page for model, taxonomy mode, thresholds, and exclusions
- Auto-placement for newly created bookmarks when confidence is high enough

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Load the generated `dist` directory in Chrome:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select this repo's `dist` folder

## Local AI Endpoint

The default endpoint is:

```text
http://localhost:8317/v1
```

The extension expects:

- `GET /models`
- `POST /chat/completions`

The response format is OpenAI-compatible.

## Privacy

Bookmark titles, URLs, folder paths, and optional page summaries are sent only to the configured local endpoint. The extension does not include telemetry.

## License

MIT
