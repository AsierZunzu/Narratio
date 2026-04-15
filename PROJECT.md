# Narratio — Project Definition

Narratio is a self-hosted application that converts RSS feed articles into a podcast feed with AI-generated audio. It fetches articles, synthesises speech via [Piper TTS](https://github.com/rhasspy/piper), and serves a standards-compliant Podcast RSS feed that any podcast client can subscribe to.

---

## Purpose & Use Case

- Subscribe to any RSS feed and automatically receive audio versions of its articles.
- The generated podcast feed is compatible with clients such as Pinepods.
- Designed for self-hosting alongside the wider homelab Docker stack.

---

## Architecture

Two independent processes share a database and a filesystem volume.

### Worker

- Validates the RSS URL (format + reachability).
- Enforces feed-URL consistency against the stored value in SQLite.
- Runs once immediately if a certain arg is nnot set to false, then on the `POLL_INTERVAL` cron schedule.
- Handles `--force-reset` (wipes DB + audio) and `--retry-failed` (resets TTS counters) CLI flags.
- Listens for SIGTERM/SIGINT to shut down gracefully.

### RSS Service (`src/services/rss.ts`)

- Fetches the RSS feed with a configurable timeout (`RSS_FETCH_TIMEOUT`).
- Extracts per-article images from: iTunes, `media:content`, `media:thumbnail`, enclosures, or inline `<img>` tags.
- Converts HTML content to plain text via (skips `img`, `figure`; strips link hrefs).
- Inserts new articles into the database; skips duplicates (primary-key constraint).
- Requests text-to-audio conversion for each new article; on failure, records the error and increments tts retry count.
- After processing new articles, retries previously failed articles that have not yet exhausted a maximum amount of retries, that is configfurableble via ENV variable.
- Marks articles as permanently failed once the retry limit is reached.
- runs a cleanup strategy after every run to enforce quota limits.
- Listens for SIGTERM/SIGINT to shut down gracefully.

### Server

Web with two routes:

| Route | Description |
|---|---|
| `GET /audio/:file` | Static file serving from `data/audio/` |
| `GET /rss` | Builds and returns Podcast-compatible XML |

On startup, the server generates two fallback audio files (if absent):
- `data/audio/unavailable.wav` — spoken via TTS using `UNAVAILABLE_MESSAGE`.
- `data/audio/tts-failed.wav` — spoken via TTS using `TTS_FAILED_MESSAGE`.

The `/rss` endpoint reads all published articles from SQLite (articles with audio, purged articles, or permanently-failed articles) and constructs the XML feed using the `podcast` npm package. Articles are tagged `[PURGED]` or `[TTS FAILED]` in the feed title when their audio is a fallback.


### Cleanup

After each RSS poll, it enforces two optional quotas:

- `MAX_AUDIO_FILES` — maximum number of active WAV files.
- `MAX_AUDIO_SIZE_MB` — maximum total disk usage.

When limits are exceeded, the oldest articles are deleted from disk and marked as purged. Purged articles remain visible in the podcast feed with the fallback audio.


## Configuration (Environment Variables)

### Worker

| Variable | Default | Description |
|---|---|---|
| `RSS_URL` | *(required)* | RSS feed URL to poll |
| `POLL_INTERVAL` | *(unset)* | Cron expression. If unset, runs once and exits |
| `PIPER_HOST` | `localhost` | Piper TTS TCP host |
| `PIPER_PORT` | `10200` | Piper TTS TCP port |
| `TTS_TIMEOUT` | `300` | TTS timeout in **seconds** (multiplied by 1000 internally) |
| `TTS_MAX_RETRIES` | `3` | Max retry attempts per article. `0` = disable retries |
| `RSS_FETCH_TIMEOUT` | `30000` | RSS fetch timeout in milliseconds |
| `MAX_AUDIO_FILES` | `Infinity` | Max WAV files to retain |
| `MAX_AUDIO_SIZE_MB` | `Infinity` | Max total audio storage in MB |

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `PODCAST_TITLE` | `Narratio` | Feed title |
| `PODCAST_DESCRIPTION` | *(dynamic)* | Feed description |
| `PODCAST_AUTHOR` | `Narratio Worker` | Feed author |
| `PODCAST_LANGUAGE` | `en` | Feed language |
| `PODCAST_ITUNES_AUTHOR` | *(PODCAST_AUTHOR)* | iTunes author |
| `PODCAST_ITUNES_SUMMARY` | *(PODCAST_DESCRIPTION)* | iTunes summary |
| `PODCAST_ITUNES_OWNER_NAME` | *(PODCAST_AUTHOR)* | iTunes owner name |
| `PODCAST_ITUNES_OWNER_EMAIL` | `worker@example.com` | iTunes owner email |
| `PODCAST_ITUNES_CATEGORY` | `Technology` | iTunes category |
| `UNAVAILABLE_MESSAGE` | `This content is no longer available on the server.` | Fallback audio text for purged articles |
| `TTS_FAILED_MESSAGE` | `This podcast episode could not be generated due to a text-to-speech error.` | Fallback audio text for TTS-failed articles |

---

## CLI Flags (Worker)

| Flag | Effect                                                                                          |
|---|-------------------------------------------------------------------------------------------------|
| `--force-reset` | Deletes all audio files and reinitialises the SQLite database. Required when changing `RSS_URL` |
| `--retry-failed` | Resets tts retry count to 0 for all articles, then immediately runs ingestion                  |

---

## Docker Compose Stack

Three services, all defined in `compose.yaml`:

| Service           | Role |
|-------------------|----|
| `narratio-server` | Web server                         |
| `narratio-worker` | RSS poller + TTS dispatcher        |
| `tts`             | TTS engine |

Both application services share the `./data/app` volume mounted at `/app/data`. Both depend on `piper` with a health check that probes the Wyoming TCP port. Piper voice models are persisted in `./data/piper`.

The single Docker image runs either the server or the worker depending on the `command` field.

---


## Test Suite

All the code comes with unit tests

---