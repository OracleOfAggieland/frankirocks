// The remembered "Lab spider" toggle, kept the way ui/sound/preference.ts keeps sound. On by default,
// including when storage is missing or throws.

export const SPIDER_KEY = "franki.spider";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSpiderOn(storage: StorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(SPIDER_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeSpiderOn(on: boolean, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(SPIDER_KEY, on ? "on" : "off");
  } catch {
    // not remembered for this Visit
  }
}
