/**
 * Keys of the rows the route writes, by the contract's Scope column (contracts §3), as extraction's `scopeFor` makes
 * them, so a route write and a later extraction of the same words meet on one key. Pure.
 */
import { type Hasher, idParts } from "../ids";
import type { EID, ID, Pred, Value } from "../schema/primitives";

const fold = (s: unknown): string | null => (typeof s === "string" && s.normalize("NFKC").replace(/\s+/g, " ").trim() !== "" ? s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase() : null);

/** The predicates the on-turn routes write (design 3.2, 3.3). */
export type RoutePred = Extract<Pred, "identity.name" | "person.life" | "employment.status" | "employment.role" | "person.relation" | "place.residence" | "care">;

const ROUTE_PREDS: ReadonlySet<string> = new Set(["identity.name", "person.life", "employment.status", "employment.role", "person.relation", "place.residence", "care"]);

export const isRoutePred = (p: string): p is RoutePred => ROUTE_PREDS.has(p);

/** The scopeId extraction's `scopeFor` gives the same row. `place.residence` is the `home` scope (G23). */
export function scopeOf(predicate: RoutePred, args: Record<string, unknown>, _value: Value, hasher: Hasher): string {
  const h = (...parts: unknown[]) => hasher.id(["scope", ...parts]);
  switch (predicate) {
    case "identity.name":
    case "person.life":
    case "employment.status":
      return "global";
    case "person.relation":
      return typeof args.otherRef === "string" ? h(args.otherRef) : "global";
    case "employment.role":
      return typeof args.employerRef === "string" ? h(args.employerRef) : "global";
    case "place.residence":
      return h("home");
    case "care":
      return h(args.careSubjectRef ?? null, fold(args.topic));
  }
}

/** The Memory key of a row the route writes. */
export function keyOf(subjectId: EID, predicate: RoutePred, args: Record<string, unknown>, value: Value, hasher: Hasher): { scopeId: string; key: ID } {
  const scopeId = scopeOf(predicate, args, value, hasher);
  return { scopeId, key: hasher.id(idParts.memoryKey(subjectId, predicate, scopeId)) };
}
