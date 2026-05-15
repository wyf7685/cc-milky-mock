import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolveUri(uri: string): Promise<Buffer> {
  if (uri.startsWith('file://')) {
    const filePath = fileURLToPath(uri);
    return readFileSync(filePath);
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const resp = await fetch(uri);
    if (!resp.ok) throw new Error(`Failed to fetch ${uri}: ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }
  if (uri.startsWith('base64://')) {
    return Buffer.from(uri.slice(9), 'base64');
  }
  throw new Error(`Unsupported URI scheme: ${uri}`);
}

export function guessExtension(uri: string, buffer: Buffer): string {
  if (uri.match(/\.(png|jpe?g|gif|webp|bmp|tiff?)$/i)) {
    const ext = uri.match(/\.(\w+)$/)?.[1]?.toLowerCase();
    if (ext) return ext === 'jpg' ? 'jpeg' : ext;
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'gif';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'webp';
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp';
  return 'bin';
}

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  bin: 'application/octet-stream',
};

export function getMimeType(ext: string): string {
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export function getImageDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 8) return { width: 0, height: 0 };

  // PNG: IHDR chunk at bytes 16-23
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    if (buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
  }

  // GIF: bytes 6-9
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    if (buffer.length >= 10) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      return { width, height };
    }
  }

  // JPEG: scan for SOF marker (0xFF 0xC0-0xCF, excluding 0xFF 0xC4 DHT and 0xFF 0xCC)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc) {
        if (offset + 9 < buffer.length) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
      }
      if (offset + 3 < buffer.length) {
        const segLen = buffer.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      } else {
        break;
      }
    }
  }

  // WebP: RIFF....WEBP, VP8 chunk at offset 12
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    if (buffer.length >= 30 && buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
      const width = (buffer.readUInt16LE(26)) & 0x3fff;
      const height = (buffer.readUInt16LE(28)) & 0x3fff;
      return { width, height };
    }
  }

  return { width: 0, height: 0 };
}
