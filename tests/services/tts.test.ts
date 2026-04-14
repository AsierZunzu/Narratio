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

const FAKE_WAV = Buffer.from('RIFF....WAVEfmt ', 'ascii');

describe('synthesise', () => {
  const servers: net.Server[] = [];
  afterEach(() => {
    for (const s of servers) s.close();
    servers.length = 0;
  });

  it('writes raw WAV response to output file', async () => {
    const { server, port } = await startMockServer((socket) => {
      socket.once('data', () => {
        socket.end(FAKE_WAV);
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
    expect(fs.readFileSync(outPath)).toEqual(FAKE_WAV);
  });

  it('handles Wyoming framed events with audio-chunk payloads', async () => {
    const payload = Buffer.from('WAVBYTES', 'ascii');
    const event = JSON.stringify({
      type: 'audio-chunk',
      payload_length: payload.length,
    }) + '\n';

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
    expect(fs.readFileSync(outPath)).toEqual(payload);
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
    ).rejects.toThrow('empty');
  });
});
