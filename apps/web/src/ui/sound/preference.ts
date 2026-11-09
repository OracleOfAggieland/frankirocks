// The remembered Sound_Toggle value (lab-ui-foundation R19.6). On by default, including when storage
// is missing or throws.

export const SOUND_KEY = "franki.sound";

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

export function readSoundOn(storage: StorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeSoundOn(on: boolean, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // not remembered for this Visit
  }
}
