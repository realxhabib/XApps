/**
 * Test helper: a minimal browser (window, localStorage, sessionStorage) for
 * running the demo backend under Node. Import it before anything from ./store.
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

export const fakeLocalStorage = new MemoryStorage();
export const fakeSessionStorage = new MemoryStorage();

const g = globalThis as Record<string, unknown>;
const define = (name: string, value: unknown) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

define("localStorage", fakeLocalStorage);
define("sessionStorage", fakeSessionStorage);
if (typeof g.window === "undefined") {
  define("window", {
    localStorage: fakeLocalStorage,
    sessionStorage: fakeSessionStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

/** Wipes both storages (the demo store reseeds on next load). */
export function resetFakeBrowser(): void {
  fakeLocalStorage.clear();
  fakeSessionStorage.clear();
}
