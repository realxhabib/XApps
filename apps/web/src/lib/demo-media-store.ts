/**
 * In-memory store behind `/api/demo-media` (demo mode only): uploads live in
 * the dev server's memory, least recently used first out once the total
 * passes 200 MB. Nothing is persisted; a restart forgets every file.
 *
 * The POST and GET routes are bundled separately, so the store hangs off
 * `globalThis` to be shared between them (and to survive hot reloads).
 */
import { randomBytes } from "node:crypto";

export const DEMO_MEDIA_CAPACITY = 200 * 1024 * 1024;

export interface DemoMediaEntry {
  bytes: Uint8Array;
  mime: string;
  createdAt: number;
}

export class DemoMediaStore {
  private entries = new Map<string, DemoMediaEntry>();
  private total = 0;

  constructor(readonly capacity = DEMO_MEDIA_CAPACITY) {}

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.total;
  }

  /** Stores a file and returns its id, evicting the least recently used files to make room. */
  put(bytes: Uint8Array, mime: string): string {
    if (bytes.byteLength > this.capacity) throw new Error("File is larger than the demo media store");
    while (this.total + bytes.byteLength > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    const id = randomBytes(16).toString("hex");
    this.entries.set(id, { bytes, mime, createdAt: Date.now() });
    this.total += bytes.byteLength;
    return id;
  }

  /** Reads a file and marks it as recently used. */
  get(id: string): DemoMediaEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.total -= entry.bytes.byteLength;
  }
}

const g = globalThis as { __xappsDemoMedia?: DemoMediaStore };

export function demoMediaStore(): DemoMediaStore {
  g.__xappsDemoMedia ??= new DemoMediaStore();
  return g.__xappsDemoMedia;
}
