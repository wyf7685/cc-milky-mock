import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveUri, getImageDimensions, guessExtension } from './image.js';

export interface ResourceEntry {
  resourceId: string;
  filePath: string;
  sourceUri: string;
  extension: string;
  width: number;
  height: number;
  summary: string;
  subType: 'normal' | 'sticker';
  createdAt: number;
}

export class ResourceStore {
  private resources = new Map<string, ResourceEntry>();
  private baseDir: string;

  constructor() {
    this.baseDir = join(tmpdir(), 'milky-mcp', randomUUID());
    mkdirSync(this.baseDir, { recursive: true });
    console.error(`[milky-mcp] resource store: ${this.baseDir}`);
  }

  async resolveAndStore(
    uri: string,
    options?: { subType?: string; summary?: string },
  ): Promise<ResourceEntry> {
    const buffer = await resolveUri(uri);
    const dimensions = getImageDimensions(buffer);
    const extension = guessExtension(uri, buffer);
    const resourceId = `res_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const filePath = join(this.baseDir, `${resourceId}.${extension}`);

    writeFileSync(filePath, buffer);

    const entry: ResourceEntry = {
      resourceId,
      filePath,
      sourceUri: uri,
      extension,
      width: dimensions.width,
      height: dimensions.height,
      summary: options?.summary ?? '[图片]',
      subType: (options?.subType === 'sticker' ? 'sticker' : 'normal'),
      createdAt: Math.floor(Date.now() / 1000),
    };

    this.resources.set(resourceId, entry);
    return entry;
  }

  getEntry(resourceId: string): ResourceEntry | undefined {
    return this.resources.get(resourceId);
  }

  getFilePath(resourceId: string): string | undefined {
    return this.resources.get(resourceId)?.filePath;
  }

  cleanup(): void {
    if (existsSync(this.baseDir)) {
      rmSync(this.baseDir, { recursive: true, force: true });
      console.error(`[milky-mcp] resource store cleaned up: ${this.baseDir}`);
    }
    this.resources.clear();
  }
}
