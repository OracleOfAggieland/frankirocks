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
      className={`${TARGET} ${FOCUS} inline-flex items-center justify-center rounded-full border border-brass/70 text-brass transition-colors duration-(--dur-quick) hover:border-brass hover:bg-brass/10 hover:text-brass-hi`}
    >
      {/* A speaker drawn in line: the box and its cone, then two sound waves on, or a small cross off. */}
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="h-5 w-5" data-sound={on ? "on" : "off"}>
        <path d="M2.75 7.75 H5.75 L9.75 4.25 V15.75 L5.75 12.25 H2.75 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        {on ? (
          <path d="M12.75 7.5 A3.5 3.5 0 0 1 12.75 12.5 M15 5.25 A6.75 6.75 0 0 1 15 14.75" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        ) : (
          <path d="M13 8 L17 12 M17 8 L13 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
