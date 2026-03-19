import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { Socket } from 'net';

const DATA_DIR = join(process.cwd(), 'data');
const AUDIO_DIR = join(DATA_DIR, 'audio');
const PIPER_HOST = process.env.PIPER_HOST || 'localhost';
const PIPER_PORT = parseInt(process.env.PIPER_PORT || '10200');
const TIMEOUT_MS = parseInt(process.env.TTS_TIMEOUT || '300') * 1000;

function buildWav(pcmData: Buffer, sampleRate: number, sampleWidth: number, channels: number): Buffer {
  const byteRate = sampleRate * channels * sampleWidth;
  const blockAlign = channels * sampleWidth;
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);                        // ChunkID
  header.writeUInt32LE(36 + dataSize, 4);         // ChunkSize
  header.write('WAVE', 8);                        // Format
  header.write('fmt ', 12);                       // Subchunk1ID
  header.writeUInt32LE(16, 16);                   // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20);                    // AudioFormat (PCM = 1)
  header.writeUInt16LE(channels, 22);             // NumChannels
  header.writeUInt32LE(sampleRate, 24);           // SampleRate
  header.writeUInt32LE(byteRate, 28);             // ByteRate
  header.writeUInt16LE(blockAlign, 32);           // BlockAlign
  header.writeUInt16LE(sampleWidth * 8, 34);      // BitsPerSample
  header.write('data', 36);                       // Subchunk2ID
  header.writeUInt32LE(dataSize, 40);             // Subchunk2Size

  return Buffer.concat([header, pcmData]);
}

export async function textToAudio(id: string, text: string, customPath?: string): Promise<string> {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(AUDIO_DIR)) {
    mkdirSync(AUDIO_DIR, { recursive: true });
  }

  const audioPath = customPath || join(AUDIO_DIR, `${id}.wav`);

  return new Promise((resolve, reject) => {
    const client = new Socket();
    let receivedData = false;
    let audioData = Buffer.alloc(0);

    // Wyoming protocol parsing state
    let buffer = Buffer.alloc(0);
    let expectedPayload = 0;
    let inPayload = false;
    let pendingDataLength = 0;      // bytes left to skip/read from a data block
    let pendingDataType = '';       // event type that owns the pending data block

    // Audio format from audio-start event
    let sampleRate = 22050;
    let sampleWidth = 2;
    let channels = 1;

    // Set a timeout to avoid hanging
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('TTS request timed out'));
    }, TIMEOUT_MS);

    client.connect(PIPER_PORT, PIPER_HOST, () => {
      console.log('Connected to Piper server');

      const event = JSON.stringify({
        type: 'synthesize',
        data: { text },
        payload_length: 0,
      });

      client.write(event + '\n');
    });

    client.on('data', (chunk) => {
      receivedData = true;
      buffer = Buffer.concat([buffer, chunk] as Uint8Array[]);

      while (buffer.length > 0) {
        if (!inPayload) {
          // Resume consuming a pending data block from a previous iteration
          if (pendingDataLength > 0) {
            if (buffer.length < pendingDataLength) break; // Still waiting

            const pendingBlock = buffer.slice(0, pendingDataLength);
            buffer = buffer.slice(pendingDataLength);
            const resolvedType = pendingDataType;
            pendingDataLength = 0;
            pendingDataType = '';

            if (resolvedType === 'audio-start') {
              try {
                const audioInfo = JSON.parse(pendingBlock.toString());
                sampleRate = audioInfo.rate ?? sampleRate;
                sampleWidth = audioInfo.width ?? sampleWidth;
                channels = audioInfo.channels ?? channels;
                console.log(`Audio format: ${sampleRate}Hz, ${sampleWidth * 8}bit, ${channels}ch`);
              } catch {
                console.warn('Could not parse audio-start data block');
              }
            } else if (resolvedType === 'error') {
              clearTimeout(timeout);
              client.destroy();
              reject(new Error(`Piper error: ${pendingBlock.toString()}`));
              return;
            }

            // If this data block belonged to an audio-chunk, enter payload state now
            if (expectedPayload > 0) {
              inPayload = true;
            }
            continue;
          }

          // Look for newline-terminated JSON header
          const newlineIdx = buffer.indexOf('\n');
          if (newlineIdx === -1) break; // Wait for more data

          const headerStr = buffer.slice(0, newlineIdx).toString();
          buffer = buffer.slice(newlineIdx + 1);

          let header: { type: string; data_length?: number; payload_length?: number };
          try {
            header = JSON.parse(headerStr);
          } catch (err) {
            // Log as hex so we can see exactly what bytes arrived
            console.error('Failed to parse Wyoming header (hex):', Buffer.from(headerStr).toString('hex'));
            console.error('Failed to parse Wyoming header (text):', JSON.stringify(headerStr));
            continue;
          }

          // console.log('Wyoming event:', header.type, JSON.stringify(header));

          // Consume the event's own data block before the next header
          if (header.data_length && header.data_length > 0) {
            if (buffer.length < header.data_length) {
              // Not enough data yet — save state and wait for more
              pendingDataLength = header.data_length;
              pendingDataType = header.type;
              // Also remember payload_length so we can enter payload state after the data block
              expectedPayload = header.payload_length ?? 0;
              break;
            }

            if (header.type === 'audio-start') {
              try {
                const audioInfo = JSON.parse(buffer.slice(0, header.data_length).toString());
                sampleRate = audioInfo.rate ?? sampleRate;
                sampleWidth = audioInfo.width ?? sampleWidth;
                channels = audioInfo.channels ?? channels;
                console.log(`Audio format: ${sampleRate}Hz, ${sampleWidth * 8}bit, ${channels}ch`);
              } catch {
                console.warn('Could not parse audio-start data block');
              }
            }

            buffer = buffer.slice(header.data_length);
          }

          // After consuming any data block, check if there is also a payload to consume
          if (header.payload_length && header.payload_length > 0) {
            expectedPayload = header.payload_length;
            inPayload = true;
          } else if (header.type === 'audio-stop') {
            clearTimeout(timeout);
            client.destroy();
            if (audioData.length === 0) {
              reject(new Error('Connected to Piper but received no audio payload'));
              return;
            }
            writeFileSync(audioPath, buildWav(audioData, sampleRate, sampleWidth, channels));
            console.log('Audio file stored at:', audioPath, `(${audioData.length} PCM bytes)`);
            resolve(audioPath);
            return;
          } else if (header.type === 'error') {
            // Read the error data block before rejecting so we can report the actual message
            if (header.data_length && header.data_length > 0) {
              if (buffer.length < header.data_length) {
                pendingDataLength = header.data_length;
                pendingDataType = 'error';
                expectedPayload = 0;
                break;
              }
              const errorMsg = buffer.slice(0, header.data_length).toString();
              buffer = buffer.slice(header.data_length);
              clearTimeout(timeout);
              client.destroy();
              reject(new Error(`Piper error: ${errorMsg}`));
              return;
            }
            clearTimeout(timeout);
            client.destroy();
            reject(new Error(`Piper error (no details): ${headerStr}`));
            return;
          }
        } else {
          // Consume binary payload bytes — may arrive across multiple TCP packets
          const available = Math.min(buffer.length, expectedPayload);
          audioData = Buffer.concat([audioData, buffer.slice(0, available)] as Uint8Array[]);
          buffer = buffer.slice(available);
          expectedPayload -= available;
          if (expectedPayload === 0) {
            inPayload = false;
          } else {
            break; // Wait for the rest of this payload chunk
          }
        }
      }
    });

    client.on('end', () => {
      clearTimeout(timeout);

      if (!receivedData) {
        reject(new Error('No data received from Piper server'));
        return;
      }

      if (audioData.length === 0) {
        reject(new Error('Connected to Piper but received no audio payload'));
        return;
      }

      writeFileSync(audioPath, buildWav(audioData, sampleRate, sampleWidth, channels));
      client.destroy();
      console.log('Audio file stored at:', audioPath, `(${audioData.length} PCM bytes)`);
      resolve(audioPath);
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`TTS request failed: ${err.message}`));
    });
  });
}