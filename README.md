# RSS-to-Podcast

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

### Worker Configuration
- `RSS_URLS`: Comma-separated list of RSS feed URLs to parse.
- `PIPER_URL`: URL of the Piper TTS engine (e.g., `http://tts-engine:5000`).

### Server Configuration
- `PORT`: The port the web server will listen on (default: `3000`).
- `PODCAST_TITLE`: Title of your generated podcast.
- `PODCAST_DESCRIPTION`: Description of your podcast.
- `PODCAST_AUTHOR`: Author name for the podcast.
- `PODCAST_LANGUAGE`: Language code (e.g., `en`, `es`).

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

- **Worker**: Periodically polls RSS feeds, extracts content, and calls the TTS engine.
- **TTS Engine**: Converts text to MP3 using [Piper](https://github.com/rhasspy/piper).
- **SQLite**: Stores article metadata and processing status.
- **Server**: Express-based web server that serves the generated MP3 files and the Podcast XML.
