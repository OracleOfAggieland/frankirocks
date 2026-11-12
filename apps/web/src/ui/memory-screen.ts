// The main screen's memory surfaces from GET /api/memory (brief 020). Pure: each function maps one view of the
// route to a surface's props, or to null when there is nothing true to show (the surface then renders nothing).
// The specimen runs its fixture through these same functions.
//
// Not filled here, because no view carries them yet: the jar's rule motes (hard rules live in core/rules, which
// no view reads), the strip's money figure (the comparison's numbers live in rollups, which no view reads; the
// last terminal says "Compared"), and the Lab counters the server names `uncounted:<field>`.
import { type InspectItem, type LabView, type MemoryResponse, type SnapshotView, type StripView, readoutFromPages } from "@franki/core";
import { COPY } from "./copy";
import { receiptFrom } from "./receipt-from";
import type { CardProps, JarProps, LabProps, MoteKind, ReceiptProps, StripProps } from "./surface-props";

/** Jar motes: one per shown card on the first page, one per guess, one per private thing held back. */
export function jarMotes(s: SnapshotView | null): JarProps["motes"] {
  if (s === null) return [];
  const motes: { id: string; kind: MoteKind }[] = s.cards.map((c) => ({ id: c.id, kind: "told" }));
  for (let i = 0; i < s.overview.guesses; i++) motes.push({ id: `guess-${i}`, kind: "guessed" });
  for (let i = 0; i < s.overview.heldPrivate; i++) motes.push({ id: `private-${i}`, kind: "private" });
  return motes;
}

/** Lab limit codes the screen has words for; any other code is dropped. */
const LIMIT_WORDS: Readonly<Record<string, string>> = { floorRecall: COPY.memory.lab.floorRecall };

/**
 * The Lab's counters: the three of spec §15 ("Read {n} emails. Guessed 3 private things. Said none."). A number
 * the server names `uncounted:<field>` shows as not counted (null), never as a zero.
 */
export function labProps(l: LabView | null): LabProps | null {
  if (l === null) return null;
  const uncounted = new Set(l.limits.filter((x) => x.startsWith("uncounted:")).map((x) => x.slice("uncounted:".length)));
  const value = (field: keyof LabView, n: number) => (uncounted.has(field) ? null : n);
  return {
    counters: [
      { id: "read", label: COPY.memory.lab.read, value: value("readEmails", l.readEmails) },
      { id: "guessed", label: COPY.memory.lab.guessed, value: value("privateGuesses", l.privateGuesses) },
      { id: "said", label: COPY.memory.lab.said, value: value("guessLinesSpoken", l.guessLinesSpoken) },
    ],
    limits: l.limits.flatMap((x) => (Object.hasOwn(LIMIT_WORDS, x) ? [LIMIT_WORDS[x]!] : [])),
  };
}

/** The strip: open only while a loop has steps; filled counts the complete steps from the first. */
export function stripProps(s: StripView | null): StripProps | null {
  if (s === null || s.loopId === null || s.steps.length === 0) return null;
  let filled = 0;
  while (filled < s.steps.length && s.steps[filled]!.state === "complete") filled++;
  return { open: true, filled: Math.min(5, filled) as StripProps["filled"], resultLabel: COPY.memory.stripResult };
}

const nat = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** The receipt slip from the `receipt` view, only once something was blocked or cleaned. Counts only. */
export function receiptProps(items: readonly InspectItem[]): ReceiptProps | null {
  const item = items.find((i) => i.kind === "receipt");
  if (item === undefined || (item.status !== "blocked" && item.status !== "cleaned")) return null;
  let body: unknown;
  try {
    body = JSON.parse(item.body);
  } catch {
    return null;
  }
  const b = body as { retainedRules?: unknown; scopePending?: unknown; touched?: unknown };
  if (!nat(b.retainedRules) || typeof b.scopePending !== "boolean" || !Array.isArray(b.touched)) return null;
  const touched = (b.touched as unknown[]).flatMap((t) => {
    const x = t as { collection?: unknown; count?: unknown };
    return typeof x.collection === "string" && nat(x.count) ? [{ collection: x.collection, count: x.count }] : [];
  });
  return receiptFrom({
    blockedAt: true,
    cleanupCompleteAt: item.status === "cleaned" ? true : null,
    retainedRuleIds: Array.from({ length: b.retainedRules }, (_, i) => String(i)),
    scopePending: b.scopePending,
    touched,
  });
}

/** The readout card for "What do you know about me?": the snapshot's lines, recent told lines first. */
export function readoutCard(pages: readonly SnapshotView[], onOpenSource: (id: string) => void): CardProps {
  const lines = readoutFromPages(pages).map((l) => l.text);
  return { kind: "read", id: "readout", title: COPY.memory.readout.title, lines: lines.length > 0 ? lines : [COPY.memory.readout.empty], sources: [], onOpenSource };
}

/** The ask card of the false "gone" check (spec §5 line 54). */
export function goneAskCard(onAnswer: (id: "yes" | "no") => void, onOpenSource: (id: string) => void): CardProps {
  return {
    kind: "ask",
    id: "gone-ask",
    title: COPY.memory.goneAsk.title,
    question: COPY.memory.goneAsk.question,
    options: [
      { id: "yes", label: COPY.memory.goneAsk.yes },
      { id: "no", label: COPY.memory.goneAsk.no },
    ],
    onAnswer: (id) => onAnswer(id === "yes" ? "yes" : "no"),
    sources: [],
    onOpenSource,
  };
}

/** The surfaces of the main screen from one read of each view. */
export interface MemorySurfaces {
  jar: JarProps["motes"];
  lab: LabProps | null;
  strip: StripProps | null;
  receipt: ReceiptProps | null;
}

export const NO_SURFACES: MemorySurfaces = { jar: [], lab: null, strip: null, receipt: null };

export function memorySurfaces(r: { overview: MemoryResponse | null; lab: MemoryResponse | null; strip: MemoryResponse | null; receipt: MemoryResponse | null }): MemorySurfaces {
  return {
    jar: jarMotes(r.overview?.snapshot ?? null),
    lab: labProps(r.lab?.lab ?? null),
    strip: stripProps(r.strip?.strip ?? null),
    receipt: receiptProps(r.receipt?.items ?? []),
  };
}
