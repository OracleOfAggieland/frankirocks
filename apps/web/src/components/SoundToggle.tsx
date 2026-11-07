"use client";
// The Sound_Toggle (lab-ui-foundation R19.6, R18.1 to R18.3): one button named "Sound effects" with
// `aria-pressed`, remembered in localStorage, on by default.
import { useSyncExternalStore } from "react";
import { FOCUS, TARGET } from "./surfaces/classes";
import { COPY } from "../ui/copy";
import { type StorageLike, readSoundOn, writeSoundOn } from "../ui/sound/preference";

export class SoundPreference {
  private on: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage?: StorageLike | null) {
    this.on = readSoundOn(storage ?? undefined);
  }

  getSnapshot = (): boolean => this.on;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set(on: boolean): void {
    this.on = on;
    writeSoundOn(on, this.storage ?? undefined);
    this.listeners.forEach((l) => l());
  }
}

let shared: SoundPreference | null = null;
export function soundPreference(): SoundPreference {
  if (shared === null) shared = new SoundPreference();
  return shared;
}

const serverOn = () => true;

export function useSoundOn(pref: SoundPreference = soundPreference()): boolean {
  return useSyncExternalStore(pref.subscribe, pref.getSnapshot, serverOn);
}

export function SoundToggle({ preference }: { preference?: SoundPreference }) {
  const pref = preference ?? soundPreference();
  const on = useSoundOn(pref);
  return <SoundToggleView on={on} onToggle={() => pref.set(!on)} />;
}

export function SoundToggleView({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={COPY.sound.toggle}
      data-sound-toggle=""
      onClick={onToggle}
      className={`${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-control border border-brass text-brass hover:bg-night-1`}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="h-5 w-5">
        <path d="M3 8 H6 L10 4 V16 L6 12 H3 Z" fill="currentColor" />
        {on ? (
          <path d="M13 7 Q15 10 13 13 M15 5 Q19 10 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        ) : (
          <path d="M13 7 L18 13 M18 7 L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
