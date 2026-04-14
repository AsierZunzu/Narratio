import net from 'net';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface TtsOptions {
  host: string;
  port: number;
  timeoutMs: number;
  outputDir: string;
}

/**
 * Synthesises text via a Piper Wyoming TTS server (TCP).
 *
 * Wyoming protocol:
 *   1. Connect to TCP socket.
 *   2. Send: {"type":"synthesize","data":{"text":"..."}}\n
 *   3. Receive: one JSON event line per chunk ("audio-start", "audio-chunk", "audio-stop"),
 *      each followed by the raw binary payload length declared in the event.
 *   Alternatively, some wyoming-piper builds stream raw WAV after the header line — we
 *   support both modes by collecting all data after the first newline.
 *
 * Returns the absolute path of the written WAV file.
 */
export async function synthesise(
  text: string,
  filename: string,
  opts: TtsOptions,
): Promise<string> {
  const outPath = path.join(opts.outputDir, filename);

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const chunks: Buffer[] = [];
    let headerSent = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      socket.destroy();
      reject(new Error(`TTS timeout after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    socket.connect(opts.port, opts.host, () => {
      const event = JSON.stringify({ type: 'synthesize', data: { text } }) + '\n';
      socket.write(event);
      headerSent = true;
    });

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    socket.on('end', () => {
      if (timedOut) return;
      clearTimeout(timeout);

      if (!headerSent) {
        return reject(new Error('TTS connection closed before header was sent'));
      }

      const raw = Buffer.concat(chunks);
      if (raw.length === 0) {
        return reject(new Error('TTS returned empty audio'));
      }

      // Wyoming servers may prefix the audio stream with JSON event lines.
      // Strip any leading JSON lines (lines starting with '{') and take the
      // remainder as raw WAV bytes.
      const newlineIdx = raw.indexOf(0x0a); // '\n'
      let audioData: Buffer;

      if (newlineIdx !== -1 && raw[0] === 0x7b /* '{' */) {
        // There are JSON event lines — collect all audio payload bytes
        audioData = extractWavFromWyoming(raw);
      } else {
        audioData = raw;
      }

      if (audioData.length === 0) {
        return reject(new Error('TTS returned no audio data after stripping events'));
      }

      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, audioData);
        logger.info(`TTS audio written: ${outPath} (${audioData.length} bytes)`);
        resolve(outPath);
      } catch (err) {
        reject(err);
      }
    });

    socket.on('error', (err) => {
      if (timedOut) return;
      clearTimeout(timeout);
      reject(new Error(`TTS connection error: ${err.message}`));
    });
  });
}

/**
 * Wyoming event framing: each event is a JSON line followed by `payload-length` bytes of
 * binary data. We accumulate all audio-chunk payloads into a single buffer.
 * If the format is not recognisable, fall back to returning everything after the first
 * non-JSON line.
 */
function extractWavFromWyoming(raw: Buffer): Buffer {
  const audioChunks: Buffer[] = [];
  let pos = 0;

  while (pos < raw.length) {
    // Find end of current JSON line
    const nlIdx = raw.indexOf(0x0a, pos);
    if (nlIdx === -1) break;

    const line = raw.subarray(pos, nlIdx).toString('utf8').trim();
    pos = nlIdx + 1;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Not a JSON line — treat remaining bytes as raw WAV
      audioChunks.push(raw.subarray(pos - line.length - 1));
      break;
    }

    const payloadLength =
      typeof event['payload_length'] === 'number' ? (event['payload_length'] as number) : 0;

    if (payloadLength > 0) {
      audioChunks.push(raw.subarray(pos, pos + payloadLength));
      pos += payloadLength;
    }
  }

  return Buffer.concat(audioChunks);
}
