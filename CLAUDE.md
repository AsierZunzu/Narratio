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
| `src/worker/index.ts` | RSS poller + TTS dispatcher. Runs once on startup, then on `POLL_INTERVAL` cron if set. Handles `--force-reset`, `--retry-failed`, and `--regen-audio` CLI flags. |
| `src/server/index.ts` | Express HTTP server. Two routes: `GET /audio/:file` (static WAV files) and `GET /rss` (podcast XML). |

### Worker CLI flags

| Flag | Behaviour |
|---|---|
| `--force-reset` | Deletes all audio files and the entire DB, then exits. Next run starts from scratch. |
| `--retry-failed` | Resets `tts_retries` to 0 and status to `pending` for all `failed` articles, then continues normal startup. |
| `--regen-audio` | Deletes all `.wav` files from `data/audio/` and resets every article (any status) to `pending` with zero retries, then exits. Useful when you want to regenerate audio with a different TTS model/voice without losing article history. |

### Data flow (worker)

1. `src/services/rss.ts` — fetches the RSS feed, extracts article images (iTunes → `media:content` → enclosures → inline `<img>`), converts HTML to plain text (`src/utils/html.ts`), inserts new articles into SQLite (`src/db/articles.ts`), calls TTS for each new article, retries previously failed articles up to `TTS_MAX_RETRIES`, then calls cleanup.
2. `src/services/tts.ts` — connects to Piper TTS via TCP (Wyoming protocol). See [Wyoming protocol](#wyoming-protocol) below.
3. `src/services/cleanup.ts` — enforces `MAX_AUDIO_FILES` and `MAX_AUDIO_SIZE_MB` quotas by deleting oldest WAV files and marking those articles as `purged`.

### Database

`src/db/index.ts` — singleton `better-sqlite3` + Drizzle ORM instance. Applies schema inline via `CREATE TABLE IF NOT EXISTS` and runs an inline migration for `tts_elapsed_ms`. No separate migration tool.

`src/db/schema.ts` — single `articles` table. Status lifecycle: `pending` → `converting` → `done` | `failed` → `purged`.

`src/db/articles.ts` — all DB queries as plain exported functions accepting a `Db` argument (no class, no global state). `resetAllArticlesForRegen` resets every article to `pending` with zero retries and clears `audio_file`; used by `--regen-audio`.

### Server

`src/server/feed.ts` — builds the podcast XML using the `podcast` npm package. Purged articles use `unavailable-${feed.id}.wav`; permanently-failed articles use `tts-failed-${feed.id}.wav`. Both fallback WAVs are generated per-feed on server startup via TTS.

`src/server/ui.ts` — serves an EJS-rendered admin/status page. Templates live in `src/server/templates/` and must be copied to `dist/server/templates/` at build time (handled by the build script).

### Utilities

- `src/utils/env.ts` — typed env accessor functions (call as `env.RSS_URL()`, etc.). Throws on missing required vars.
- `src/utils/logger.ts` — structured JSON logger wrapping `console`.

### Wyoming protocol

`src/services/tts.ts` implements a TCP client for the Wyoming protocol used by `wyoming-piper`.

**Happy path (proper framing):**
1. Open TCP connection to `PIPER_HOST:PIPER_PORT`.
2. Send: `{"type":"synthesize","data":{"text":"..."}}\n`
3. Receive a stream of framed events. Each event is three contiguous sections:
   - JSON header line (`\n`-terminated): `{"type":"...","data_length":N,"payload_length":M}`
   - Data section: `data_length` bytes of UTF-8 JSON (audio format: rate/width/channels). Present on `audio-start` and `audio-chunk`.
   - Payload section: `payload_length` bytes of raw binary PCM. Present on `audio-chunk` only.

   Older builds embed format info directly in the header's `data` field instead of a separate data section — both forms are handled.
4. On `audio-stop`: concatenate all PCM chunks, prepend a 44-byte WAV header built from the `audio-start` format info, write to `outputDir/<filename>`.

**Non-JSON fallback:** When a line in the stream fails JSON parsing, its bytes are pushed directly to `audioChunks` and framing continues. On connection close, any remaining `recvBuf` bytes are also appended before settling. This handles `wyoming-piper` builds that emit raw PCM bytes containing `0x0a`.

**State machine variables** in `synthesise()`:
- `recvBuf` — binary receive accumulator; never converted to string while a payload is pending.
- `pendingDataLength` — bytes of UTF-8 JSON data section still to consume for the current event.
- `pendingPayloadLength` — bytes of raw binary PCM payload still to consume for the current event.
- `pendingEventType` — event type string of the frame currently being parsed.
- `pendingDataBuf` — accumulates data-section bytes until fully received, then parsed for audio format.
- `audioChunks` — collected PCM (or raw audio) buffers assembled at settle time.

**Error paths:** timeout (`TTS_TIMEOUT` seconds), connection refused, empty audio (Piper crash), Wyoming `error` event.

## Testing

Tests use Vitest with in-memory SQLite databases (no mocks for the DB layer). TTS tests spin up real TCP servers locally. The test suite is fully self-contained — no external services required.
