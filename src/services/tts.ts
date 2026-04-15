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

interface AudioInfo {
  rate: number;
  width: number;    // bytes per sample (e.g. 2 for 16-bit)
  channels: number;
}

/**
 * Synthesises text via a Piper Wyoming TTS server (TCP).
 *
 * Wyoming protocol (proper framing):
 *   1. Connect to TCP socket.
 *   2. Send: {"type":"synthesize","data":{"text":"..."}}\n
 *   3. Receive a stream of framed events:
 *        {"type":"audio-start","data":{"rate":N,"width":N,"channels":N},"payload_length":0}\n
 *        {"type":"audio-chunk","data":{...},"payload_length":N}\n  +  N raw PCM bytes
 *        {"type":"audio-stop","data":{},"payload_length":0}\n
 *   4. On audio-stop: assemble a WAV file (header + PCM) and write it.
 *
 * Raw-audio fallback:
 *   Some wyoming-piper builds stream raw audio bytes after the JSON event
 *   headers instead of using proper audio-chunk framing.  When non-JSON data
 *   is detected the parser switches to raw-collection mode: all subsequent
 *   bytes are accumulated as audio.  If the accumulated data already starts
 *   with a RIFF header it is written as-is; otherwise it is wrapped in a WAV
 *   header using the format info from audio-start (or sane defaults).
 *   Because the server keeps the connection open, settlement is triggered by
 *   a short idle timer (RAW_AUDIO_IDLE_MS) after the last byte arrives.
 *
 * Returns the absolute path of the written WAV file.
 */

/** Milliseconds of silence after which raw-audio mode auto-settles. */
const RAW_AUDIO_IDLE_MS = 1_000;

export async function synthesise(
  text: string,
  filename: string,
  opts: TtsOptions,
): Promise<string> {
  const outPath = path.join(opts.outputDir, filename);

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let timedOut = false;
    let settled = false;

    // Incoming binary buffer — never stringify this before consuming payload bytes.
    let recvBuf = Buffer.alloc(0);
    // Bytes of binary payload still to consume for the current event.
    let pendingPayload = 0;

    // Raw-audio fallback mode: set to true when non-JSON data is detected.
    let rawAudioMode = false;
    let rawAudioIdleTimer: ReturnType<typeof setTimeout> | null = null;

    let audioInfo: AudioInfo = { rate: 22050, width: 2, channels: 1 };
    const audioChunks: Buffer[] = [];

    const timeout = setTimeout(() => {
      timedOut = true;
      socket.destroy();
      const msg = `TTS timeout after ${opts.timeoutMs}ms waiting for ${opts.host}:${opts.port}`;
      logger.error(msg);
      reject(new Error(msg));
    }, opts.timeoutMs);

    const settle = (err?: Error) => {
      if (settled || timedOut) return;
      settled = true;
      clearTimeout(timeout);
      if (rawAudioIdleTimer) clearTimeout(rawAudioIdleTimer);
      socket.destroy();

      if (err) return reject(err);

      if (audioChunks.length === 0) {
        const msg =
          `TTS: Piper closed the connection without sending audio for "${outPath}". ` +
          `Piper likely crashed internally (check 'docker compose logs tts'). ` +
          `Common causes: text too long (OOM), unsupported characters, or model not loaded.`;
        logger.error(msg);
        return reject(new Error(msg));
      }

      const allAudio = Buffer.concat(audioChunks);
      // If the collected bytes already carry a RIFF/WAV header (raw-audio mode),
      // write them as-is.  Otherwise wrap the raw PCM in a synthesised WAV header.
      const wavData = allAudio.subarray(0, 4).toString('ascii') === 'RIFF'
        ? allAudio
        : buildWavFile(audioChunks, audioInfo);

      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, wavData);
        logger.info(`TTS audio written: ${outPath} (${wavData.length} bytes)`);
        resolve(outPath);
      } catch (writeErr) {
        reject(writeErr);
      }
    };

    /** Restart the idle-settle timer for raw-audio mode. */
    const scheduleRawAudioSettle = () => {
      if (rawAudioIdleTimer) clearTimeout(rawAudioIdleTimer);
      rawAudioIdleTimer = setTimeout(() => {
        if (!settled && !timedOut) {
          const total = audioChunks.reduce((s, c) => s + c.length, 0);
          logger.debug(`TTS: raw-audio idle timeout — settling with ${total} bytes`);
          settle();
        }
      }, RAW_AUDIO_IDLE_MS);
    };

    // Drain recvBuf according to the Wyoming framing state machine.
    function drain() {
      while (recvBuf.length > 0 && !settled && !timedOut) {
        if (pendingPayload > 0) {
          // Consume binary payload bytes for the current audio-chunk event.
          const consume = Math.min(pendingPayload, recvBuf.length);
          audioChunks.push(recvBuf.subarray(0, consume));
          recvBuf = recvBuf.subarray(consume);
          pendingPayload -= consume;
          continue;
        }

        // Look for a complete JSON event line.
        const nlIdx = recvBuf.indexOf(0x0a /* '\n' */);
        if (nlIdx === -1) break; // wait for more data

        // Keep original bytes so we can reconstruct them if JSON parsing fails.
        const lineBytes = recvBuf.subarray(0, nlIdx);
        const line = lineBytes.toString('utf8').trim();
        recvBuf = recvBuf.subarray(nlIdx + 1);
        if (!line) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Non-JSON data means the server is streaming raw audio bytes.
          // Reconstruct the bytes we just consumed (line + newline) and switch
          // to raw-collection mode for all remaining data.
          if (!rawAudioMode) {
            logger.warn(
              `TTS: non-JSON data from ${opts.host}:${opts.port} — switching to raw-audio fallback`,
            );
            rawAudioMode = true;
          }
          audioChunks.push(Buffer.concat([lineBytes, Buffer.from([0x0a]), recvBuf]));
          recvBuf = Buffer.alloc(0);
          scheduleRawAudioSettle();
          break;
        }

        const type = event['type'] as string | undefined;
        const data = event['data'] as Record<string, unknown> | undefined;
        const payloadLen =
          typeof event['payload_length'] === 'number' ? (event['payload_length'] as number) : 0;

        logger.debug(`TTS event: type=${type} payload_length=${payloadLen}`);

        if (type === 'audio-start' && data) {
          audioInfo = {
            rate: typeof data['rate'] === 'number' ? (data['rate'] as number) : 22050,
            width: typeof data['width'] === 'number' ? (data['width'] as number) : 2,
            channels: typeof data['channels'] === 'number' ? (data['channels'] as number) : 1,
          };
          logger.debug(`TTS audio-start: rate=${audioInfo.rate} width=${audioInfo.width} channels=${audioInfo.channels}`);
        } else if (type === 'audio-stop') {
          logger.debug(`TTS audio-stop received — ${audioChunks.length} chunks, total: ${audioChunks.reduce((s, c) => s + c.length, 0)} bytes`);
          settle();
          return;
        } else if (type === 'error') {
          const msg = `Wyoming TTS error from ${opts.host}:${opts.port}: ${JSON.stringify(data)}`;
          logger.error(msg);
          settle(new Error(msg));
          return;
        } else {
          logger.debug(`TTS: ignoring unknown event type="${type}"`);
        }

        if (payloadLen > 0) {
          pendingPayload = payloadLen;
        }
      }
    }

    socket.setNoDelay(true);
    socket.connect(opts.port, opts.host, () => {
      logger.info(
        `TTS sending ${text.length} chars to ${opts.host}:${opts.port} — preview: "${text.slice(0, 120).replace(/\n/g, ' ')}${text.length > 120 ? '…' : ''}"`,
      );
      const request = JSON.stringify({ type: 'synthesize', data: { text } }) + '\n';
      socket.write(request);
    });

    socket.on('data', (chunk: Buffer) => {
      if (settled || timedOut) return;
      logger.debug(`TTS received ${chunk.length} bytes from ${opts.host}:${opts.port}`);
      if (rawAudioMode) {
        // Skip the state machine — accumulate directly and reset the idle timer.
        audioChunks.push(chunk);
        scheduleRawAudioSettle();
        return;
      }
      recvBuf = Buffer.concat([recvBuf, chunk]);
      drain();
    });

    // Fallback: server closes the connection without sending audio-stop.
    socket.on('end', () => {
      if (!settled && !timedOut) settle();
    });

    socket.on('error', (err) => {
      if (timedOut || settled) return;
      clearTimeout(timeout);
      if (rawAudioIdleTimer) clearTimeout(rawAudioIdleTimer);
      const msg = `TTS connection error for ${opts.host}:${opts.port} — ${err.message}`;
      logger.error(msg);
      reject(new Error(msg));
    });
  });
}

/**
 * Assembles a valid WAV file from raw PCM chunks and audio metadata.
 * Wyoming audio-chunk payloads are raw little-endian PCM — no WAV header.
 */
function buildWavFile(pcmChunks: Buffer[], info: AudioInfo): Buffer {
  const pcmData = Buffer.concat(pcmChunks);
  const bitsPerSample = info.width * 8;
  const byteRate = info.rate * info.channels * info.width;
  const blockAlign = info.channels * info.width;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);              // fmt chunk size
  header.writeUInt16LE(1, 20);               // PCM format
  header.writeUInt16LE(info.channels, 22);
  header.writeUInt32LE(info.rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}
