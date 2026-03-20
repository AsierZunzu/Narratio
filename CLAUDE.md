# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Compile TypeScript to dist/
npm run lint         # ESLint on src/**/*.ts
npm run lint:fix     # Auto-fix lint issues
npm test             # Run all Jest tests
npx jest tests/tts.test.ts  # Run a single test file
```

## Architecture

Narratio converts RSS feeds into podcast feeds with generated audio. It has two independent processes sharing a SQLite database and a filesystem volume:

- **Worker** (`src/worker.ts`) — Polls an RSS feed on a cron schedule, extracts article text (HTML→plain text via `html-to-text`), generates audio via TTS, and stores results in SQLite.
- **Server** (`src/server.ts`) — Express app that serves generated WAV files as static assets and exposes a `/rss` endpoint that builds podcast-compatible XML from the database.
- **TTS** (`src/tts.ts`) — Communicates with an external [Piper](https://github.com/rhasspy/piper) TTS process using the Wyoming protocol over TCP. Collects PCM audio chunks and writes a RIFF WAV file to disk.
- **RSS parser** (`src/rss.ts`) — Fetches and parses feeds, then calls `textToAudio()` per article.
- **Database** (`src/database/db.ts`) — SQLite via `better-sqlite3`. Schema: `metadata` (key/value, stores `feed_url`) and `articles` (id, title, link, pub_date, content, audio_path, is_purged).
- **Storage utils** (`src/utils/storage.ts`) — Enforces `MAX_AUDIO_FILES` / `MAX_AUDIO_SIZE_MB` limits by deleting oldest audio files and marking articles as purged.

### Wyoming Protocol (TTS)

`textToAudio()` opens a TCP socket to Piper, sends a JSON `synthesize` event, then reads newline-delimited JSON headers each followed by an optional binary payload:

- `audio-start` — provides sample rate, bit depth, channels
- `audio-chunk` — raw PCM data; collected in a buffer
- `audio-stop` — triggers WAV header construction and file write
- `error` — surfaced as a thrown error

The whole operation is wrapped in a `TTS_TIMEOUT` (env var, default 30s) promise race.

## Key Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `RSS_URL` | worker | Feed URL to poll |
| `POLL_INTERVAL` | worker | Cron expression (e.g. `0 * * * *`) |
| `PIPER_HOST` / `PIPER_PORT` | worker | Wyoming TCP endpoint |
| `TTS_TIMEOUT` | worker | TTS timeout in ms (default 30000) |
| `RSS_FETCH_TIMEOUT` | worker | RSS feed fetch timeout in ms (default 30000) |
| `MAX_AUDIO_FILES` | worker | Max WAV files to retain |
| `MAX_AUDIO_SIZE_MB` | worker | Max total audio storage in MB |
| `PORT` | server | HTTP port (default 3000) |
| `PODCAST_TITLE`, `PODCAST_DESCRIPTION`, etc. | server | Feed metadata |

## Development Notes

- TypeScript compiles to `dist/` (CommonJS, ES2016 target). Run `npm run build` before `npm start`.
- Tests live in `tests/` and use `ts-jest`. The test pattern is `**/tests/**/*.test.ts`.
- The `data/` directory (audio files + SQLite DB) is gitignored. Docker Compose mounts `./data/app` to `/app/data` on both containers.
- `compose.override.yaml` is gitignored — use it for local overrides without touching `compose.yaml`.


## General instructions
- After each change, check:
  - The README is up to date
  - The code is linted
  - The tests are passing
  - Tests for new functionalities have been added
- Use relative paths on commands
