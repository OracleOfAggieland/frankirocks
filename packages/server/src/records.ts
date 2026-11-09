/** Shared builders for stored records. */
import type { ID, Slice, TS } from "@franki/core";

/** Common_Fields C with empty lineage (KC01). `rev` is set by the store at commit. */
export function cFields(uid: string, now: TS, epoch: number, policyRev: number) {
  return {
    v: 1 as const,
    uid,
    rev: 1,
    createdAt: now,
    updatedAt: now,
    epoch,
    policyRev,
    rootKeys: [] as ID[],
    rootSlices: [] as Slice[],
    contextIds: [],
    packetEids: [] as ID[],
    dependsOn: [] as string[],
    dirty: false,
    dependenciesComplete: true,
  };
}

export const DAY_MS = 86_400_000;
