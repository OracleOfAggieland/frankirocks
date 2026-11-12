/**
 * The owner's diets and dislikes for a food moment (brief 039), read from Memories through `eligible`, so a blocked
 * or forgotten row never counts. It never reads `core/rules`: the allergy path reads that, exactly as brief 037 left
 * it.
 *
 * Whose (brief 039 ruling 5, the lead's, for the owner to confirm): the owner's own diets and dislikes always apply.
 * Another person's apply only when the owner's words in this turn name that person, matched by code against the
 * person's stored labels and aliases; the model's attendee list can add a person and never remove one.
 *
 * A diet past its `validTo` is read as it stood just before its end (as an expiry ask is, time/verdict.ts): time only
 * asks, so it keeps filtering until the owner answers.
 */
import {
  type ClockPort,
  type CoreEpoch,
  type CoreState,
  type Evidence,
  type FoodPrefs,
  type HeadMemory,
  type Memory,
  docRef,
  eligible,
  foodPrefsOf,
  isDietMemory,
  isDislikeMemory,
  msFromTs,
  tsFromMs,
} from "@franki/core";
import { ownerClock } from "../core-docs";
import { foregroundEC, readAllMemories, snapshotFor } from "../head-build";
import { subjectIndex } from "../onturn/context";
import { paths } from "../store/paths";
import type { Reader } from "../store/port";

export interface PrefsRead {
  prefs: FoodPrefs;
  /** The Memories read, for the answer's write to check its row is unchanged. */
  memories: ReadonlyMap<string, Memory>;
  zone: string;
  worldNow: number;
}

const words = (s: string) => ` ${s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** The people the owner's words name: by a relation's label or code, or a stored name or alias. */
export function namedPeople(memories: readonly HeadMemory[], text: string): Set<string> {
  const t = words(text);
  const out = new Set<string>();
  const has = (a: string) => a.trim() !== "" && t.includes(words(a));
  for (const e of subjectIndex(memories, null).entries) if ([e.label, ...e.aliases].some(has)) out.add(e.id);
  for (const { memory: m } of memories) {
    if (m.status !== "active" || m.subjectId === "self") continue;
    if ((m.predicate === "identity.name" || m.predicate === "identity.alias") && m.value.kind === "text" && has(m.value.text)) out.add(m.subjectId);
  }
  return out;
}

/** The owner's own words a Memory rests on: the text of its root Slices, from their Evidence. */
function wordsOf(evidence: ReadonlyMap<string, Evidence>) {
  return (m: Memory): string =>
    m.rootSlices
      .map((s) => {
        const e = evidence.get(s.eid);
        const text = e?.text?.kind === "inline" ? e.text.text : "";
        return s.start === null || s.end === null ? "" : text.slice(s.start, s.end);
      })
      .join("\n");
}

export async function readFoodPrefs(
  reader: Reader,
  uid: string,
  clock: ClockPort,
  generation: number,
  turnText: string,
  modelIds: readonly string[],
): Promise<PrefsRead> {
  const state = (await reader.get<CoreState>(paths.core(uid, "state")))!.data;
  const epoch = (await reader.get<CoreEpoch>(paths.core(uid, "epoch")))!.data;
  const pair = ownerClock(state, clock);
  const all = await readAllMemories(reader, uid);
  const food = all.filter((h) => isDietMemory(h.memory) || isDislikeMemory(h.memory));
  const snapshot = await snapshotFor(reader, uid, food, epoch, generation);
  const evidence = new Map<string, Evidence>();
  snapshot.refs.forEach((r, i) => {
    if (r.collection === "evidence") evidence.set(r.id, snapshot.rows[i] as Evidence);
  });
  const now = pair.worldClock.now;
  const ec = { ...foregroundEC(uid, epoch, pair, generation), stage: "toolReturn" as const };
  const kept = food.filter(({ id, memory: m }) => {
    const ended = m.validTo !== null && now >= msFromTs(m.validTo);
    const at = ended && isDietMemory(m) ? msFromTs(m.validTo!) - 1 : now;
    return eligible({ ref: docRef("memories", id, m.rev), row: m }, { ...ec, worldNow: tsFromMs(at) }, snapshot).allow;
  });
  const named = namedPeople(all, turnText);
  const applies = (s: string) => s === "self" || named.has(s) || modelIds.includes(s);
  const prefs = foodPrefsOf({ memories: kept, at: now, zone: pair.worldClock.zone, applies, wordsOf: wordsOf(evidence) });
  return { prefs, memories: new Map(kept.map((h) => [h.id, h.memory])), zone: pair.worldClock.zone, worldNow: now };
}
