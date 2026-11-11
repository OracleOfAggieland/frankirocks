/**
 * Keys of the rows the route writes, by the contract's Scope column (contracts §3). The scope comes from extraction's
 * own `scopeIdOf`, the one scope function, so a route write and a later extraction of the same words meet on one key.
 * Pure.
 */
import { scopeIdOf } from "../extract";
import { type Hasher, idParts } from "../ids";
import type { EID, ID, Pred, Value } from "../schema/primitives";

/** The predicates the on-turn routes write (design 3.2, 3.3). */
export type RoutePred = Extract<Pred, "identity.name" | "person.life" | "employment.status" | "employment.role" | "person.relation" | "place.residence" | "care">;

/**
 * The scopeId of a row: extraction's scope for the same predicate, args and value, with no free `scope` string, so
 * `place.residence` is the `home` scope (G23).
 */
export function scopeOf(predicate: Pred, args: Record<string, unknown>, value: Value, hasher: Hasher): string {
  return scopeIdOf(predicate, null, args, value, hasher);
}

/** The Memory key of a row the route writes. */
export function keyOf(subjectId: EID, predicate: RoutePred, args: Record<string, unknown>, value: Value, hasher: Hasher): { scopeId: string; key: ID } {
  const scopeId = scopeOf(predicate, args, value, hasher);
  return { scopeId, key: hasher.id(idParts.memoryKey(subjectId, predicate, scopeId)) };
}
