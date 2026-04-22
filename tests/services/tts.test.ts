import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { synthesise } from '../../src/services/tts.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'narratio-tts-'));
}

function startMockServer(
  handler: (socket: net.Socket) => void,
): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

describe('synthesise', () => {
  const servers: net.Server[] = [];
  afterEach(() => {
    for (const s of servers) s.close();
    servers.length = 0;
  });

  it('builds a valid WAV file from Wyoming audio events', async () => {
    const pcm = Buffer.alloc(100, 0xab); // fake PCM samples
    const audioStart = JSON.stringify({ type: 'audio-start', data: { rate: 16000, width: 2, channels: 1 }, payload_length: 0 }) + '\n';
    const audioChunk = JSON.stringify({ type: 'audio-chunk', data: {}, payload_length: pcm.length }) + '\n';
    const audioStop  = JSON.stringify({ type: 'audio-stop', data: {} }) + '\n';

    const { server, port } = await startMockServer((socket) => {
      socket.once('data', () => {
        socket.write(Buffer.concat([
          Buffer.from(audioStart),
          Buffer.from(audioChunk),
          pcm,
          Buffer.from(audioStop),
        ]));
      });
    });
    servers.push(server);

    const tmpDir = makeTempDir();
    const outPath = await synthesise('Hello world', 'test.wav', {
      host: '127.0.0.1',
      port,
      timeoutMs: 5000,
      outputDir: tmpDir,
    });

    expect(fs.existsSync(outPath)).toBe(true);
    const wav = fs.readFileSync(outPath);
    expect(wav.length).toBe(44 + pcm.length);            // 44-byte WAV header + PCM
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(44)).toEqual(pcm);                // PCM content preserved
  });

  it('handles Wyoming framed events with audio-chunk payloads', async () => {
    const payload = Buffer.from('WAVBYTES', 'ascii');
    const event = JSON.stringify({
      type: 'audio-chunk',
      payload_length: payload.length,
    }) + '\n';

    // Server sends an audio-chunk then closes without audio-stop; the client
    // falls back to settling on connection close and wraps PCM in a WAV header.
    const { server, port } = await startMockServer((socket) => {
      socket.once('data', () => {
        socket.end(Buffer.concat([Buffer.from(event), payload]));
      });
    });
    servers.push(server);

    const tmpDir = makeTempDir();
    const outPath = await synthesise('Test', 'framed.wav', {
      host: '127.0.0.1',
      port,
      timeoutMs: 5000,
      outputDir: tmpDir,
    });

    expect(fs.existsSync(outPath)).toBe(true);
    const wav = fs.readFileSync(outPath);
    expect(wav.length).toBe(44 + payload.length);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(44)).toEqual(payload);
  });

  it('rejects on timeout', async () => {
    const { server, port } = await startMockServer((socket) => {
      // Server accepts but never sends data
      socket.once('data', () => { /* silent */ });
    });
    servers.push(server);

    const tmpDir = makeTempDir();
    await expect(
      synthesise('Slow', 'slow.wav', {
        host: '127.0.0.1',
        port,
        timeoutMs: 100,
        outputDir: tmpDir,
      }),
    ).rejects.toThrow('TTS timeout');
  });

  it('rejects when server refuses connection', async () => {
    const tmpDir = makeTempDir();
    await expect(
      synthesise('Hello', 'refused.wav', {
        host: '127.0.0.1',
        port: 19999, // nothing listening
        timeoutMs: 3000,
        outputDir: tmpDir,
      }),
    ).rejects.toThrow();
  });

  it('rejects when server returns empty audio', async () => {
    const { server, port } = await startMockServer((socket) => {
      socket.once('data', () => socket.end());
    });
    servers.push(server);

    const tmpDir = makeTempDir();
    await expect(
      synthesise('Empty', 'empty.wav', {
        host: '127.0.0.1',
        port,
        timeoutMs: 3000,
        outputDir: tmpDir,
      }),
    ).rejects.toThrow('without sending audio');
  });

  it('raw-audio fallback: wraps non-Wyoming bytes in a WAV header', async () => {
    // Simulate a server that streams raw PCM (with \n bytes in the data)
    // then closes the connection — no Wyoming event framing at all.
    const rawPcm = Buffer.concat([
      Buffer.from('hello\nworld\n'),  // contains \n bytes that would fool the JSON parser
      Buffer.alloc(20, 0x55),
    ]);

    const { server, port } = await startMockServer((socket) => {
      socket.once('data', () => socket.end(rawPcm));
    });
    servers.push(server);

    const tmpDir = makeTempDir();
    const outPath = await synthesise('Test', 'raw.wav', {
      host: '127.0.0.1',
      port,
      timeoutMs: 3000,
      outputDir: tmpDir,
    });

    const wav = fs.readFileSync(outPath);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(44)).toEqual(rawPcm);
  });
});
