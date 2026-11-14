/**
 * Query shapes this slice may run (R7.8, R7.9; KS08; contracts §9). The five composite indexes are the ones
 * `firestore.indexes.json` declares (a test keeps the two in step). Q14 (turns by seq) and Q28 (by document ID)
 * need no composite index, nor does Q45 (sessions by lastTurnAt, newest first; brief 045), nor Q49 (errands by
 * startedAt, newest first; brief 049), nor Q50 (errands by retainUntil, with a range on it; brief 049 review fix R12). The Memory_Store rejects any other shape, as Firestore would without its index.
 */
import type { Collection } from "./paths";
import type { QuerySpec } from "./port";

export interface CompositeIndex {
  query: string;
  collection: Collection;
  fields: { fieldPath: string; order: "ASCENDING" | "DESCENDING" }[];
}

export const COMPOSITE_INDEXES: readonly CompositeIndex[] = [
  {
    query: "Q03",
    collection: "memories",
    fields: [
      { fieldPath: "key", order: "ASCENDING" },
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "validFromKey", order: "DESCENDING" },
    ],
  },
  {
    query: "Q13",
    collection: "sessions",
    fields: [
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "expiresAt", order: "ASCENDING" },
    ],
  },
  {
    query: "Q17",
    collection: "jobs",
    fields: [
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "nextAttemptAt", order: "ASCENDING" },
    ],
  },
  {
    query: "Q18",
    collection: "jobs",
    fields: [
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "leaseUntil", order: "ASCENDING" },
    ],
  },
  {
    query: "Q33",
    collection: "ledger",
    fields: [
      { fieldPath: "kind", order: "ASCENDING" },
      { fieldPath: "at", order: "DESCENDING" },
    ],
  },
];

/** Names the query ID a spec matches, or returns null when no declared shape serves it. */
export function matchQueryShape(collection: Collection, spec: QuerySpec): string | null {
  const { field: orderField, dir } = spec.orderBy;
  const equalities = spec.where.filter((f) => f.op === "==").map((f) => f.field);
  const ranges = spec.where.filter((f) => f.op !== "==");
  if (new Set(equalities).size !== equalities.length) return null;
  if (ranges.some((f) => f.field !== orderField)) return null;

  // Q28: paged reads by document ID, ascending.
  if (orderField === "__name__") return equalities.length === 0 && dir === "asc" ? "Q28" : null;
  // Q14: turns by seq, ascending, single-field index.
  if (collection === "turns" && orderField === "seq") return equalities.length === 0 && dir === "asc" ? "Q14" : null;
  // Brief 045 (finding 2): an open reads the Owner's latest Sessions by last turn, newest first, single-field index.
  if (collection === "sessions" && orderField === "lastTurnAt") return equalities.length === 0 && ranges.length === 0 && dir === "desc" ? "Q45" : null;
  // Brief 049 part A: the Owner's latest Errands, newest first, single-field index.
  if (collection === "errands" && orderField === "startedAt") return equalities.length === 0 && ranges.length === 0 && dir === "desc" ? "Q49" : null;
  // Brief 049 review fix R12: the Errands still holding what they found, by `retainUntil`, single-field index.
  if (collection === "errands" && orderField === "retainUntil") return equalities.length === 0 && dir === "asc" ? "Q50" : null;

  for (const index of COMPOSITE_INDEXES) {
    if (index.collection !== collection) continue;
    const last = index.fields[index.fields.length - 1]!;
    const leading = index.fields.slice(0, -1).map((f) => f.fieldPath);
    if (last.fieldPath !== orderField) continue;
    if ((last.order === "ASCENDING" ? "asc" : "desc") !== dir) continue;
    if (leading.length !== equalities.length || !leading.every((f) => equalities.includes(f))) continue;
    return index.query;
  }
  return null;
}
