import { describe, expect, it } from "vitest";
import { SOUND_KEY, type StorageLike, readSoundOn, writeSoundOn } from "./preference";

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const broken: StorageLike = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

describe("sound preference", () => {
  it("defaults to on when missing, without storage, or when storage throws", () => {
    expect(readSoundOn(memory())).toBe(true);
    expect(readSoundOn(null)).toBe(true);
    expect(readSoundOn(broken)).toBe(true);
    expect(() => writeSoundOn(false, broken)).not.toThrow();
  });

  it("remembers off and on", () => {
    const s = memory();
    writeSoundOn(false, s);
    expect(s.data.get(SOUND_KEY)).toBe("off");
    expect(readSoundOn(s)).toBe(false);
    writeSoundOn(true, s);
    expect(s.data.get(SOUND_KEY)).toBe("on");
    expect(readSoundOn(s)).toBe(true);
  });
});
