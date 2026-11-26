/**
 * Who the phone-side Franki calls for, and when it is for them. Read once, when the recipient's SIP leg arrives, so a
 * forget before then reaches it; a forget during the call does not (the phone call's known limit).
 */
import { isSelfNameRow, ownerName } from "@franki/core";
import { ownerClock, readCoreDocs } from "../core-docs";
import { foregroundEC, readAllMemories, snapshotFor, storeReader } from "../head-build";
import type { RouteDeps } from "../routes/runtime";

export interface PhoneCaller {
  /** The owner's own short name, by the Head's own pick, or null. */
  name: string | null;
  /** The owner's local date and time, worded, with the zone. */
  localTime: string;
}

/** The owner's local date and time, such as "Thursday, November 26, 2026 at 3:42 PM (America/Chicago)". */
export function phoneLocalTime(ms: number, zone: string): string {
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(ms);
  return `${when} (${zone})`;
}

export async function readPhoneCaller(deps: RouteDeps, uid: string): Promise<PhoneCaller> {
  const reader = storeReader(deps.store, uid);
  const core = await readCoreDocs(reader, uid);
  const pair = ownerClock(core.state.data, deps.clock);
  // A phone call happens in real time, so the ops clock, as the bank's periods do.
  const localTime = phoneLocalTime(pair.opsClock.now, core.state.data.currentZone);
  if (core.epoch.data.barrier !== null) return { name: null, localTime };
  const names = (await readAllMemories(reader, uid)).filter((hm) => isSelfNameRow(hm.memory));
  if (names.length === 0) return { name: null, localTime };
  const snapshot = await snapshotFor(reader, uid, names, core.epoch.data, 0);
  // A stranger hears it, so the audience is company: an S0 name only, and nothing when unsure.
  const ec = { ...foregroundEC(uid, core.epoch.data, pair, 0), audience: "company" as const };
  return { name: ownerName({ memories: names, ec, snapshot, audience: "company" })?.text ?? null, localTime };
}
