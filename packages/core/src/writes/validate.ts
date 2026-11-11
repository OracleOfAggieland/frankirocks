/**
 * Validation (design 2.4): spans, authority per covering slice, act, speaker, subject, value and gazetteer, one
 * verdict per item. Pure; writes nothing. Stub from wave A task A2; task A5 builds it.
 */
import type { FastSlotsOut, ItemVerdict, ValidateContext } from "./types";
import { NotBuilt } from "./types";

export function validateItems(_out: FastSlotsOut, _ctx: ValidateContext): ItemVerdict[] {
  throw new NotBuilt("validateItems");
}
