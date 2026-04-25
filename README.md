# Narratio

Self-hosted RSS-to-podcast. Fetches articles from any RSS feed, synthesises them into audio via [Piper TTS](https://github.com/rhasspy/piper), and serves a standards-compliant Podcast RSS feed that any podcast client (Pinepods, Pocket Casts, Overcast, etc.) can subscribe to.

---

## How it works

```
RSS Feed  ──►  Worker  ──►  Piper TTS  ──►  WAV files
                  │                              │
                SQLite  ◄─────────────────────────┘
                  │
              Server  ──►  GET /rss   (podcast feed)
                       ──►  GET /      (dashboard)
                       ──►  GET /audio/:file
```

A single `narratio` container runs both processes, sharing a SQLite database and audio volume with each other:

- **Worker** — polls the RSS feed on a cron schedule, converts each new article to audio via Piper TTS over TCP, and runs cleanup to enforce disk quotas.
- **Server** — serves the podcast RSS feed, static audio files, and a web dashboard.
- **TTS** (`wyoming-piper`) — local text-to-speech engine; no API keys, no cloud, no per-character cost.

---

## Quick start

**1. Copy and edit the config:**

```bash
cp .env.dist .env
```

Set at minimum:

```env
RSS_URL=https://example.com/feed.xml
BASE_URL=http://your-server:3000   # must be reachable by your podcast client
PIPER_VOICE=en_US-lessac-medium    # see Voice models below
```

**2. Start:**

```bash
docker compose up --build
```

Piper downloads the selected voice model on first run (~30–150 MB depending on quality). Once the `tts` health check passes, the worker begins ingesting articles.

**3. Subscribe:**

Point your podcast client at:

```
http://your-server:3000/rss
```

Open the dashboard at `http://your-server:3000`.

---

## Configuration

All configuration is via environment variables. Copy `.env.dist` to `.env` and adjust.

### Worker

| Variable | Default | Description |
|---|---|---|
| `RSS_URL` | *(required)* | RSS feed URL to poll |
| `POLL_INTERVAL` | *(unset)* | Cron expression. If unset, runs once and exits |
| `FORCE_RESET` | *(unset)* | Set to `true` to wipe DB + audio on container startup |
| `TTS_TIMEOUT` | `300` | TTS timeout in seconds |
| `TTS_MAX_RETRIES` | `3` | Max retry attempts per article. `0` = no retries |
| `RSS_FETCH_TIMEOUT` | `30000` | RSS fetch timeout in milliseconds |
| `MAX_AUDIO_FILES` | *(unlimited)* | Max WAV files to retain |
| `MAX_AUDIO_SIZE_MB` | *(unlimited)* | Max total audio storage in MB |

### TTS / Piper

| Variable | Default | Description |
|---|---|---|
| `PIPER_VOICE` | `en_US-lessac-medium` | Voice model (see below) |
| `PIPER_HOST` | `tts` | Piper TCP host (set automatically in Compose) |
| `PIPER_PORT` | `10200` | Piper TCP port |

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `BASE_URL` | *(derived from request)* | Public URL for audio/feed links. Optional — when unset, derived from the request's `Host` header and `X-Forwarded-Proto` (reverse-proxy friendly). Set explicitly if the external URL differs from what Node sees |
| `PODCAST_TITLE` | `Narratio` | Feed title |
| `PODCAST_DESCRIPTION` | *(empty)* | Feed description |
| `PODCAST_AUTHOR` | `Narratio Worker` | Feed author |
| `PODCAST_LANGUAGE` | `en` | Feed language (ISO 639-1) |
| `PODCAST_ITUNES_CATEGORY` | `Technology` | iTunes category |
| `PODCAST_ITUNES_OWNER_EMAIL` | `worker@example.com` | iTunes owner email |
| `UNAVAILABLE_MESSAGE` | *"This content is no longer available…"* | Spoken when a purged article is played |
| `TTS_FAILED_MESSAGE` | *"This podcast episode could not be generated…"* | Spoken when TTS failed |

---

## Voice models

Piper supports many languages and voices. Browse the full list at [github.com/rhasspy/piper/blob/master/VOICES.md](https://github.com/rhasspy/piper/blob/master/VOICES.md).

Voice name format: `{language}_{region}-{name}-{quality}`

Quality tiers: `x_low` → `low` → `medium` → `high` (higher = better audio, slower synthesis, larger model file).

**Examples:**

| Language | Voice | Notes |
|---|---|---|
| English (US) | `en_US-lessac-medium` | Default |
| English (GB) | `en_GB-alan-medium` | British accent |
| Spanish (Spain) | `es_ES-sharvard-medium` | |
| Spanish (Mexico) | `es_MX-claude-high` | Highest quality |
| German | `de_DE-thorsten-medium` | |
| French | `fr_FR-upmc-medium` | |

Set `PIPER_VOICE` in your `.env` and restart. The model is downloaded automatically on first start and cached in `./data/piper`.

---

## Dashboard

The web dashboard at `http://your-server:3000` shows all articles and their processing status.

**Status badges:**

| Badge | Meaning |
|---|---|
| **Pending** | Waiting for TTS synthesis |
| **Converting** | TTS synthesis in progress |
| **Done** | Audio generated, visible in podcast feed |
| **Failed** | TTS failed (see retry count and error) |
| **Purged** | Audio deleted by cleanup quota; article still in feed with fallback audio |

**Actions:**

| Button | Available on | Effect |
|---|---|---|
| ↗ Article | Articles with a source link | Opens original article in a new tab |
| Retry | Failed articles | Resets retry counter → pending; worker will re-attempt on next poll |
| Purge | Done articles | Deletes audio file immediately, frees disk space |
| Delete | Any article | Removes article from DB entirely (will be re-ingested on next poll) |

Click an article title to preview the plain-text content that was sent to TTS.

---

## Worker CLI flags

Run these by overriding the container command:

```bash
docker compose run --rm narratio node dist/worker/index.js --force-reset
docker compose run --rm narratio node dist/worker/index.js --retry-failed
```

| Flag | Effect |
|---|---|
| `--force-reset` | Deletes all audio files and reinitialises the database. **Required when changing `RSS_URL`.** |
| `--retry-failed` | Resets retry counters for all failed articles, then runs immediately |
| `--regen-audio` | Deletes all `.wav` files from `data/audio/` and resets every article (any status) to `pending` with zero retries, then exits. Useful when you want to regenerate audio with a different TTS model/voice without losing article history. |

---

## Storage layout

```
data/
  app/
    narratio.db       # SQLite database
    audio/
      <guid>.wav      # Generated audio files
      unavailable.wav # Fallback for purged articles
      tts-failed.wav  # Fallback for failed articles
  piper/              # Piper voice model cache
```

Both volumes are mounted from `./data` on the host.

---

## Development

**Requirements:** Node.js 22+, npm

```bash
npm install
npm run build      # TypeScript → dist/
npm test           # Vitest unit tests
npm run lint       # Run all lint:* scripts (ts, templates, docker, js)
```

Tests use in-memory SQLite and mock TCP servers — no Piper instance needed.

**Coverage:**

```bash
npx vitest run --coverage
```

Opens an HTML report at `coverage/index.html`. Install the provider on first run if prompted:

```bash
npm install --save-dev @vitest/coverage-v8
npx vitest run --coverage
```

---

## Docker Compose services

| Service | Role |
|---|---|
| `tts` | Piper TTS engine (Wyoming TCP protocol, port 10200) |
| `narratio` | RSS worker + web server (both run inside one container via `docker-entrypoint.sh`) |

`narratio` depends on `tts` with a TCP health check and mounts `./data/app` at `/app/data`.

To trigger a one-off force-reset without overriding the command, set `FORCE_RESET=true` in your `.env` — the entrypoint will wipe the DB and audio before starting normally.
