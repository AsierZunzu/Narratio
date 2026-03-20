# RSS-to-Podcast

> **Personal project** — built for self-use and as a testbed for exploring different AI-assisted programming techniques and tools. Shared as-is with no guarantees of stability, support, or general-purpose usability.

RSS-to-Podcast is a TypeScript-based application that periodically fetches articles from RSS feeds, converts them into natural-sounding audio files using the Piper TTS engine, and serves them as a valid Podcast RSS feed compatible with services like Pinepods.

## Prerequisites

- **Node.js**: version 24 or higher
- **Docker & Docker Compose** (for easy deployment)

## Installation & Build

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd rss-to-podcast
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

## Configuration

The application can be configured using environment variables. Default values are provided in `compose.yaml`.

### Changing the RSS Feed URL

Once the application is started with an `RSS_URL`, it stores this URL in its database to maintain consistency. If you need to change the RSS feed URL later, you must reinitialize the database, which will also delete all previously fetched articles and generated audio files.

**Manual Reinitialization:**
If you are running the worker manually, use the `--force-reset` flag:
```bash
npm run start:worker -- <NEW_RSS_URL> --force-reset
```

**Docker Reinitialization:**
If you are using Docker Compose, you can update the `RSS_URL` in your `compose.yaml` (or environment) and then run the following command to reinitialize:
```bash
docker compose run --rm worker npm run start:worker -- <NEW_RSS_URL> --force-reset
```
Alternatively, you can manually delete the contents of the `data/` directory and restart the stack.

### Worker Configuration
- `RSS_URL`: The RSS feed URL to parse (required).
- `POLL_INTERVAL`: Cron expression for periodic polling (e.g., `0 * * * *` for hourly). If not set, the worker runs once and exits.
- `PIPER_HOST`: Host of the Piper TTS engine Wyoming API (default: `localhost`).
- `PIPER_PORT`: Port of the Piper TTS engine Wyoming API (default: `10200`).
- `MAX_AUDIO_FILES`: Maximum number of audio files to keep (default: `Infinity`).
- `MAX_AUDIO_SIZE_MB`: Maximum total size of audio files in MB (default: `Infinity`).
- `NODE_ENV`: Set to `production` for optimized execution.
- `TTS_TIMEOUT`: Timeout for the TTS engine in seconds (default: `300`).
- `TTS_MAX_RETRIES`: Maximum number of times to retry TTS generation for a failed article on subsequent polls (default: `3`). Set to `0` to disable retries.

### Server Configuration
- `PORT`: The port the web server will listen on (default: `3000`).
- `PODCAST_TITLE`: Title of your generated podcast (default: `RSS to Podcast`).
- `PODCAST_DESCRIPTION`: Description of your podcast (default: dynamic based on feed URL).
- `PODCAST_AUTHOR`: Author name for the podcast (default: `RSS to Podcast Worker`).
- `PODCAST_LANGUAGE`: Language code (default: `en`).
- `PODCAST_ITUNES_AUTHOR`: iTunes-specific author name (defaults to `PODCAST_AUTHOR`).
- `PODCAST_ITUNES_SUMMARY`: iTunes-specific summary (defaults to `PODCAST_DESCRIPTION`).
- `PODCAST_ITUNES_OWNER_NAME`: iTunes-specific owner name (defaults to `PODCAST_AUTHOR`).
- `PODCAST_ITUNES_OWNER_EMAIL`: iTunes-specific owner email (default: `worker@example.com`).
- `PODCAST_ITUNES_CATEGORY`: iTunes-specific category (default: `Technology`).
- `UNAVAILABLE_MESSAGE`: Message to be used for purged articles (default: `This content is no longer available on the server.`).

## Usage

### Using Docker (Recommended)

The easiest way to run the full stack (Worker, Server, and TTS engine) is using Docker Compose:

```bash
docker compose up -d
```

This will:
- Start the **TTS engine** using the Piper image.
- Start the **Worker** to fetch RSS feeds and generate audio.
- Start the **Server** to provide the podcast feed at `http://localhost:3000/rss`.

### Running Manually

If you prefer to run components manually:

1. **Start the Worker** to ingest feeds:
   ```bash
   npm run start:worker -- <RSS_URL1> <RSS_URL2>
   ```

2. **Start the Server** to serve the podcast:
   ```bash
   npm run start:server
   ```

## Development

### Running Tests
We use Jest for testing. To run the full test suite:
```bash
npm test
```

### Linting
To check for code style issues:
```bash
npm run lint
```

To automatically fix linting issues:
```bash
npm run lint:fix
```

## Architecture

- **Worker**: Periodically polls RSS feeds, extracts content, and calls the TTS engine via Wyoming protocol (TCP).
- **TTS Engine**: Converts text to WAV using [Piper](https://github.com/rhasspy/piper).
- **SQLite**: Stores article metadata and processing status.
- **Server**: Express-based web server that serves the generated MP3 files and the Podcast XML.
