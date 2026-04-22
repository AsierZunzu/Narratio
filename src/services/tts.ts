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
 * Wyoming protocol — each event arrives as three contiguous sections:
 *   1. JSON header line (\n-terminated):
 *        {"type":"audio-start","data_length":N,"payload_length":0}
 *        {"type":"audio-chunk","data_length":N,"payload_length":M}
 *        {"type":"audio-stop","data_length":0,"payload_length":0}
 *      The header carries `data_length` (bytes of the following UTF-8 JSON data
 *      section) and `payload_length` (bytes of the following raw binary PCM section).
 *   2. Data section: `data_length` bytes of UTF-8 JSON containing audio format
 *      metadata (rate, width, channels).  Present on audio-start and audio-chunk.
 *   3. Payload section: `payload_length` bytes of raw binary PCM audio.
 *      Present on audio-chunk only; zero-length for audio-start and audio-stop.
 *
 * Inline-data fallback: older Wyoming builds embed format info directly in the
 * header's `data` field (e.g. `{"type":"audio-start","data":{"rate":N,...},"payload_length":0}`)
 * instead of using a separate data section.  Both forms are handled; the inline
 * `data` field is read first, then overridden by any subsequent data section.
 *
 * Non-JSON fallback: if a line in the stream fails JSON parsing the bytes are
 * treated as raw PCM and accumulated as audio so that non-framed streams still
 * produce valid output.
 *
 * On audio-stop (or connection close): all accumulated PCM chunks are assembled
 * into a WAV file.  If the collected bytes already carry a RIFF header they are
 * written as-is; otherwise a 44-byte WAV header is prepended using the format
 * captured from the data sections (defaulting to 22050 Hz / 16-bit / mono).
 *
 * @returns The absolute path of the written WAV file.
 */

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
    // Wyoming frames each event as three contiguous sections:
    //   1. JSON header line (ends with \n): {"type":"...","data_length":N,"payload_length":M}
    //   2. Data section: N bytes of UTF-8 JSON (contains audio format metadata)
    //   3. Payload section: M bytes of raw binary PCM
    // The two counters below track how many bytes remain in each section.
    let pendingDataLength = 0;    // bytes of UTF-8 JSON data section still to consume
    let pendingPayloadLength = 0; // bytes of raw binary payload still to consume
    let pendingEventType: string | null = null;
    // Accumulates bytes for the data section until fully received, then parsed.
    let pendingDataBuf = Buffer.alloc(0);

    let audioInfo: AudioInfo = { rate: 22050, width: 2, channels: 1 };
    const audioChunks: Buffer[] = [];

    const timeout = setTimeout(() => {
      timedOut = true;
      socket.destroy();
      const msg = `TTS timeout after ${opts.timeoutMs}ms waiting`;
      logger.error(msg);
      reject(new Error(msg));
    }, opts.timeoutMs);

    const settle = (err?: Error) => {
      if (settled || timedOut) return;
      settled = true;
      clearTimeout(timeout);
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
      // If the collected bytes already carry a RIFF/WAV header, write as-is;
      // otherwise wrap the raw PCM in a synthesised WAV header.
      const wavData = allAudio.subarray(0, 4).toString('ascii') === 'RIFF'
        ? allAudio
        : buildWavFile(audioChunks, audioInfo);

      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, wavData);
        const pcmBytes = wavData.length - 44;
        const durationSec = pcmBytes / (audioInfo.rate * audioInfo.channels * audioInfo.width);
        logger.info(`TTS audio written: ${outPath} (${wavData.length} bytes, ${durationSec.toFixed(2)}s @ ${audioInfo.rate}Hz/${audioInfo.width * 8}bit/${audioInfo.channels}ch)`);
        resolve(outPath);
      } catch (writeErr) {
        reject(writeErr);
      }
    };

    // Drain recvBuf according to the Wyoming framing state machine.
    //
    // Each event arrives as three contiguous sections:
    //   1. JSON header line (\n-terminated): carries type, data_length, payload_length.
    //   2. Data section (data_length bytes): UTF-8 JSON with audio format metadata.
    //   3. Payload section (payload_length bytes): raw binary PCM audio.
    //
    // The loop handles one section at a time in strict order so that the JSON data
    // section bytes are never mistaken for audio, which would produce clicks/noise.
    function drain() {
      while (recvBuf.length > 0 && !settled && !timedOut) {
        // Phase 1: consume the data section (UTF-8 JSON metadata).
        if (pendingDataLength > 0) {
          const consume = Math.min(pendingDataLength, recvBuf.length);
          pendingDataBuf = Buffer.concat([pendingDataBuf, recvBuf.subarray(0, consume)]);
          recvBuf = recvBuf.subarray(consume);
          pendingDataLength -= consume;

          if (pendingDataLength === 0) {
            // Fully received — parse format info (present on audio-start and audio-chunk).
            try {
              const fmt = JSON.parse(pendingDataBuf.toString('utf8')) as Record<string, unknown>;
              if (typeof fmt['rate'] === 'number') audioInfo.rate = fmt['rate'] as number;
              if (typeof fmt['width'] === 'number') audioInfo.width = fmt['width'] as number;
              if (typeof fmt['channels'] === 'number') audioInfo.channels = fmt['channels'] as number;
              logger.debug(`TTS ${pendingEventType} data section: rate=${audioInfo.rate} width=${audioInfo.width} channels=${audioInfo.channels}`);
            } catch {
              logger.warn(`TTS: failed to parse data section for ${pendingEventType}, using defaults`);
            }
            pendingDataBuf = Buffer.alloc(0);
          }
          continue;
        }

        // Phase 2: consume the payload section (raw binary PCM).
        if (pendingPayloadLength > 0) {
          const consume = Math.min(pendingPayloadLength, recvBuf.length);
          audioChunks.push(recvBuf.subarray(0, consume));
          recvBuf = recvBuf.subarray(consume);
          pendingPayloadLength -= consume;
          continue;
        }

        // Both sections fully consumed — look for the next JSON header line.
        const nlIdx = recvBuf.indexOf(0x0a /* '\n' */);
        if (nlIdx === -1) break; // wait for more data

        const lineBytes = recvBuf.subarray(0, nlIdx);
        const line = lineBytes.toString('utf8').trim();
        recvBuf = recvBuf.subarray(nlIdx + 1);
        if (!line) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Non-JSON bytes (raw PCM containing 0x0a) — treat as audio and keep going
          // so we can still detect audio-stop later.
          audioChunks.push(lineBytes);
          audioChunks.push(Buffer.from([0x0a]));
          continue;
        }

        const type = event['type'] as string | undefined;
        const dataInline = event['data'] as Record<string, unknown> | undefined;
        const dataLen = typeof event['data_length'] === 'number' ? (event['data_length'] as number) : 0;
        const payloadLen = typeof event['payload_length'] === 'number' ? (event['payload_length'] as number) : 0;

        logger.debug(`TTS event: type=${type} data_length=${dataLen} payload_length=${payloadLen}`);

        if (type === 'audio-start') {
          // Format info may be inline in the header `data` field (older Wyoming) or
          // in the following data section (data_length > 0). Handle both.
          if (dataInline && typeof dataInline === 'object') {
            if (typeof dataInline['rate'] === 'number') audioInfo.rate = dataInline['rate'] as number;
            if (typeof dataInline['width'] === 'number') audioInfo.width = dataInline['width'] as number;
            if (typeof dataInline['channels'] === 'number') audioInfo.channels = dataInline['channels'] as number;
            logger.debug(`TTS audio-start (inline): rate=${audioInfo.rate} width=${audioInfo.width} channels=${audioInfo.channels}`);
          }
        } else if (type === 'audio-stop') {
          logger.debug(`TTS audio-stop received — ${audioChunks.length} chunks, total: ${audioChunks.reduce((s, c) => s + c.length, 0)} bytes`);
          settle();
          return;
        } else if (type === 'error') {
          const msg = `Wyoming TTS error: ${JSON.stringify(dataInline)}`;
          logger.error(msg);
          settle(new Error(msg));
          return;
        } else {
          logger.debug(`TTS: ignoring unknown event type="${type}"`);
        }

        // Queue data section then payload section for the next iterations.
        pendingEventType = type ?? null;
        pendingDataLength = dataLen;
        pendingPayloadLength = payloadLen;
        pendingDataBuf = Buffer.alloc(0);
      }
    }

    socket.setNoDelay(true);
    socket.connect(opts.port, opts.host, () => {
      logger.info(
        `TTS sending ${text.length} chars — preview: "${text.slice(0, 120).replace(/\n/g, ' ')}${text.length > 120 ? '…' : ''}"`,
      );
      const request = JSON.stringify({ type: 'synthesize', data: { text } }) + '\n';
      socket.write(request);
    });

    socket.on('data', (chunk: Buffer) => {
      if (settled || timedOut) return;
      logger.debug(`TTS received ${chunk.length} bytes`);
      recvBuf = Buffer.concat([recvBuf, chunk]);
      drain();
    });

    // Server closes the connection after audio-stop (or on error).
    socket.on('end', () => {
      if (settled || timedOut) return;
      // Flush any bytes that remain in recvBuf but couldn't form a complete Wyoming
      // event line (e.g. raw-PCM bytes after the last \n in a non-framed stream).
      if (recvBuf.length > 0) {
        audioChunks.push(recvBuf);
        recvBuf = Buffer.alloc(0);
      }
      settle();
    });

    socket.on('error', (err) => {
      if (timedOut || settled) return;
      clearTimeout(timeout);
      const msg = `TTS connection error — ${err.message}`;
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
