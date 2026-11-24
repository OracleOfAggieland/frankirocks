/**
 * The simulator token (brief 054, design "Demo core"). A demo visit's connectors hold, sealed, a plain string of one
 * exact shape in place of a provider's token: `fsim1~<kind>~<fixtureId>~<worldStart>~<zone>`. The routing ports read
 * the unsealed string with `readSimToken` before anything else, so tokens decide where a call goes, not a flag.
 *
 * Why a live token never reads as one: Plaid access tokens start `access-`, Google refresh tokens `1//` and access
 * tokens `ya29.`, and the prefix is tested first. Why a malformed one never reaches a live port: anything that starts
 * with the prefix and is not exactly what `simToken` writes reads "malformed", which the ports refuse. Why a visitor
 * cannot make one: it is only ever stored sealed, under a key the visitor never holds.
 */
import { isZone } from "@franki/core";

export const SIM_PREFIX = "fsim1~";
/** A bank access token; a Google refresh token; a Google access token (in memory only, inside one read). */
export const SIM_KINDS = ["bank", "refresh", "access"] as const;
export type SimKind = (typeof SIM_KINDS)[number];

export interface SimToken {
  kind: SimKind;
  /** A fixture ID: 43 characters of the ID alphabet. */
  fixtureId: string;
  /** The visit's world start, integer milliseconds since the epoch. */
  worldStart: number;
  /** The visit's IANA zone. */
  zone: string;
}

/**
 * The whole grammar. `~` is in none of the field classes, so the parse is unambiguous. `worldStart` has no leading
 * zero, so every token has exactly one spelling and reading then writing gives the same string back.
 */
const SIM_TOKEN = /^fsim1~(bank|refresh|access)~([A-Za-z0-9_-]{43})~(0|[1-9]\d{0,14})~([A-Za-z0-9_+/-]{1,64})$/;

/** `fsim1~<kind>~<fixtureId>~<worldStart>~<zone>`. Printable ASCII, no space. Throws on a value the grammar cannot hold. */
export function simToken(t: SimToken): string {
  const s = `${SIM_PREFIX}${t.kind}~${t.fixtureId}~${t.worldStart}~${t.zone}`;
  // Never write a token that would not read back as itself: a bad one would be refused at every read anyway.
  const back = readSimToken(s);
  if (back === null || back === "malformed" || back.kind !== t.kind || back.fixtureId !== t.fixtureId || back.worldStart !== t.worldStart || back.zone !== t.zone) {
    throw new Error("simulator token: a field does not fit the grammar");
  }
  return s;
}

/** null: not a simulator token (it does not start with `SIM_PREFIX`). "malformed": it does, and does not parse. */
export function readSimToken(token: string): SimToken | "malformed" | null {
  if (!token.startsWith(SIM_PREFIX)) return null;
  const m = SIM_TOKEN.exec(token);
  if (m === null) return "malformed";
  const zone = m[4]!;
  if (!isZone(zone)) return "malformed";
  return { kind: m[1] as SimKind, fixtureId: m[2]!, worldStart: Number(m[3]), zone };
}
