/**
 * Spoken templates for moments (design note 023 gap 14). Code words the line; a speaking model may only reword it.
 * Lines name the occasion in the owner's own words (the Memory's value) and a time code formats.
 */
import { localMinuteOf } from "../dates";
import type { Memory } from "../schema/records";

const MAX_WORDS = 160;

/** "2 PM", "2:30 PM" for a local minute. */
export function clockLabel(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const mm = minute % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/** The occasion in the owner's words, trimmed, without a final period. */
export function occasionWords(m: Memory): string {
  const text = m.value.kind === "text" ? m.value.text : "your plans";
  return text.trim().replace(/[.!?]+$/, "").slice(0, MAX_WORDS) || "your plans";
}

export function wishLine(m: Memory, startMs: number, zone: string): string {
  return `Good luck at ${clockLabel(localMinuteOf(startMs, zone))}: ${occasionWords(m)}.`;
}

export function checkInLine(m: Memory): string {
  return `How did it go: ${occasionWords(m)}?`;
}

export function expiryAskLine(m: Memory): string {
  const line = m.sayAs?.text ?? occasionWords(m);
  return `Is this still true: ${line.trim().replace(/[.!?]+$/, "").slice(0, MAX_WORDS)}?`;
}

/**
 * Brief 042 item 3: a confirmed reminder whose due time passed while a crisis held it, said late at the next line
 * not under crisis: "You asked me to remind you about X at 10 PM. I held it."
 */
export function heldReminderLine(note: string, minute: number): string {
  return `You asked me to remind you about ${note.trim().replace(/[.!?]+$/, "").slice(0, MAX_WORDS) || "your reminder"} at ${clockLabel(minute)}. I held it.`;
}

export function reminderLine(note: string): string {
  return `Reminder: ${note.trim().replace(/[.!?]+$/, "").slice(0, MAX_WORDS)}.`;
}
