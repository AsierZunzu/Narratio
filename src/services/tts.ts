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
 * Wyoming protocol:
 *   1. Connect to TCP socket.
 *   2. Send: {"type":"synthesize","data":{"text":"..."}}\n
 *   3. Receive a stream of framed events:
 *        {"type":"audio-start","data":{"rate":N,"width":N,"channels":N},"payload_length":0}\n
 *        {"type":"audio-chunk","data":{...},"payload_length":N}\n  +  N raw PCM bytes
 *        {"type":"audio-stop","data":{},"payload_length":0}\n
 *   4. On audio-stop: assemble a WAV file (header + PCM) and write it.
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
    let timedOut = false;
    let settled = false;

    // Incoming binary buffer — never stringify this before consuming payload bytes.
    let recvBuf = Buffer.alloc(0);
    // Bytes of binary payload still to consume for the current event.
    let pendingPayload = 0;

    let audioInfo: AudioInfo = { rate: 22050, width: 2, channels: 1 };
    const pcmChunks: Buffer[] = [];

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
      socket.destroy();

      if (err) return reject(err);

      if (pcmChunks.length === 0) {
        const msg = `TTS returned no audio data for "${outPath}" — Piper may have rejected the input text`;
        logger.error(msg);
        return reject(new Error(msg));
      }

      const wavData = buildWavFile(pcmChunks, audioInfo);
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, wavData);
        logger.info(`TTS audio written: ${outPath} (${wavData.length} bytes)`);
        resolve(outPath);
      } catch (writeErr) {
        reject(writeErr);
      }
    };

    // Drain recvBuf according to the Wyoming framing state machine.
    function drain() {
      while (recvBuf.length > 0 && !settled && !timedOut) {
        if (pendingPayload > 0) {
          // Consume binary payload bytes for the current audio-chunk event.
          const consume = Math.min(pendingPayload, recvBuf.length);
          pcmChunks.push(recvBuf.subarray(0, consume));
          recvBuf = recvBuf.subarray(consume);
          pendingPayload -= consume;
          continue;
        }

        // Look for a complete JSON event line.
        const nlIdx = recvBuf.indexOf(0x0a /* '\n' */);
        if (nlIdx === -1) break; // wait for more data

        const line = recvBuf.subarray(0, nlIdx).toString('utf8').trim();
        recvBuf = recvBuf.subarray(nlIdx + 1);
        if (!line) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue; // skip non-JSON lines
        }

        const type = event['type'] as string | undefined;
        const data = event['data'] as Record<string, unknown> | undefined;
        const payloadLen =
          typeof event['payload_length'] === 'number' ? (event['payload_length'] as number) : 0;

        if (type === 'audio-start' && data) {
          audioInfo = {
            rate: typeof data['rate'] === 'number' ? (data['rate'] as number) : 22050,
            width: typeof data['width'] === 'number' ? (data['width'] as number) : 2,
            channels: typeof data['channels'] === 'number' ? (data['channels'] as number) : 1,
          };
        } else if (type === 'audio-stop') {
          settle();
          return;
        } else if (type === 'error') {
          const msg = `Wyoming TTS error from ${opts.host}:${opts.port}: ${JSON.stringify(data)}`;
          logger.error(msg);
          settle(new Error(msg));
          return;
        }

        if (payloadLen > 0) {
          pendingPayload = payloadLen;
        }
      }
    }

    socket.connect(opts.port, opts.host, () => {
      const request = JSON.stringify({ type: 'synthesize', data: { text } }) + '\n';
      socket.write(request);
    });

    socket.on('data', (chunk: Buffer) => {
      if (settled || timedOut) return;
      recvBuf = Buffer.concat([recvBuf, chunk]);
      drain();
    });

    // Fallback: if the server closes the connection without an audio-stop event.
    socket.on('end', () => {
      if (!settled && !timedOut) settle();
    });

    socket.on('error', (err) => {
      if (timedOut || settled) return;
      clearTimeout(timeout);
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
