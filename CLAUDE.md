# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # tsc compile + copy EJS templates to dist/server/
npm run lint         # type-check only (tsc --noEmit)
npm test             # vitest run (all tests, single pass)
npm run test:watch   # vitest in watch mode
```

Run a single test file:
```bash
npx vitest run tests/services/rss.test.ts
```

## Architecture

Narratio converts RSS articles into a podcast feed with AI-generated audio. Two independent Node processes share a SQLite database and a `data/audio/` filesystem volume.

### Process split

| Entry point | Role |
|---|---|
| `src/worker/index.ts` | RSS poller + TTS dispatcher. Runs once on startup, then on `POLL_INTERVAL` cron if set. Handles `--force-reset` and `--retry-failed` CLI flags. |
| `src/server/index.ts` | Express HTTP server. Two routes: `GET /audio/:file` (static WAV files) and `GET /rss` (podcast XML). |

### Data flow (worker)

1. `src/services/rss.ts` — fetches the RSS feed, extracts article images (iTunes → `media:content` → enclosures → inline `<img>`), converts HTML to plain text (`src/utils/html.ts`), inserts new articles into SQLite (`src/db/articles.ts`), calls TTS for each new article, retries previously failed articles up to `TTS_MAX_RETRIES`, then calls cleanup.
2. `src/services/tts.ts` — connects to Piper TTS via TCP (Wyoming protocol). See [Wyoming protocol](#wyoming-protocol) below.
3. `src/services/cleanup.ts` — enforces `MAX_AUDIO_FILES` and `MAX_AUDIO_SIZE_MB` quotas by deleting oldest WAV files and marking those articles as `purged`.

### Database

`src/db/index.ts` — singleton `better-sqlite3` + Drizzle ORM instance. Applies schema inline via `CREATE TABLE IF NOT EXISTS` and runs an inline migration for `tts_elapsed_ms`. No separate migration tool.

`src/db/schema.ts` — single `articles` table. Status lifecycle: `pending` → `converting` → `done` | `failed` → `purged`.

`src/db/articles.ts` — all DB queries as plain exported functions accepting a `Db` argument (no class, no global state).

### Server

`src/server/feed.ts` — builds the podcast XML using the `podcast` npm package. Purged articles use `unavailable.wav`; permanently-failed articles use `tts-failed.wav`. Both fallback WAVs are generated on server startup via TTS.

`src/server/ui.ts` — serves an EJS-rendered admin/status page. Templates live in `src/server/templates/` and must be copied to `dist/server/templates/` at build time (handled by the build script).

### Utilities

- `src/utils/env.ts` — typed env accessor functions (call as `env.RSS_URL()`, etc.). Throws on missing required vars.
- `src/utils/logger.ts` — structured JSON logger wrapping `console`.

### Wyoming protocol

`src/services/tts.ts` implements a TCP client for the Wyoming protocol used by `wyoming-piper`.

**Happy path (proper framing):**
1. Open TCP connection to `PIPER_HOST:PIPER_PORT`.
2. Send: `{"type":"synthesize","data":{"text":"..."}}\n`
3. Receive a stream of newline-delimited JSON event frames:
   - `{"type":"audio-start","data":{"rate":N,"width":N,"channels":N},"payload_length":0}\n` — captures PCM format for WAV header construction.
   - `{"type":"audio-chunk","data":{...},"payload_length":N}\n` + N raw PCM bytes — the binary payload is consumed directly from the receive buffer (not as text).
   - `{"type":"audio-stop","data":{},"payload_length":0}\n` — signals completion; WAV file is assembled and written.
4. On `audio-stop`: concatenate all PCM chunks, prepend a 44-byte WAV header built from the `audio-start` format info, write to `outputDir/<filename>`.

**Raw-audio fallback:** Some `wyoming-piper` builds stream raw bytes instead of framed events after the initial JSON headers. When a line fails JSON parsing, the parser switches to raw-collection mode: all subsequent bytes (including the failed line) are accumulated as audio. After `RAW_AUDIO_IDLE_MS` (1 000 ms) of silence the socket is settled. If the collected data starts with `RIFF` it is written as-is; otherwise it is wrapped in a WAV header using the format captured from `audio-start` (or defaults: 22050 Hz, 16-bit, mono).

**State machine variables** in `synthesise()`:
- `recvBuf` — binary receive accumulator; never converted to string while a payload is pending.
- `pendingPayload` — bytes remaining for the current `audio-chunk` binary payload.
- `rawAudioMode` — flag that bypasses the JSON state machine once non-JSON data is detected.
- `audioChunks` — collected PCM (or raw audio) buffers assembled at settle time.

**Error paths:** timeout (`TTS_TIMEOUT` seconds), connection refused, empty audio (Piper crash), Wyoming `error` event.

## Testing

Tests use Vitest with in-memory SQLite databases (no mocks for the DB layer). TTS tests spin up real TCP servers locally. The test suite is fully self-contained — no external services required.
