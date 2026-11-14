/**
 * Brief 049 part A, review fix V1: an Errand's lines tainted by the whole run, decided by code from what the planner
 * was SHOWN, never from what it chose to cite. Pure. Runs after `checkErrandResult`.
 *
 * Always:
 *   - a read's class is the lowest-trust of the agent's own and the Evidence's now; its sensitivity the highest;
 *   - a line's sensitivity is the highest over every shown read of the run (and its own refs);
 *   - a line's text is cleaned (`cleanErrandText`, review fix V3); a line empty after cleaning is dropped; a ref the
 *     planner was never shown is dropped from its line, and a line left with none is dropped;
 *   - if any shown read is class T or M and is not mail from a sender the owner has mailed, every line is card only;
 *   - otherwise, if the run has shown T or M reads (all mail from mailed senders), a line may be spoken only if
 *     EVERY ref it cites is such a read (review fix E9: a line that mixes one with an own event or own message, or
 *     cites none, is card only), attributed by code to every sender it cites, at most
 *     `ERRAND_ATTRIBUTED_SENDERS_MAX` (more: card only);
 *   - a sender the owner hasn't mailed is named by address only, never by display name (review fix T5);
 *   - only a run with no shown T or M read speaks its lines, as `O`.
 * With `opaque` (a read that could not be registered), every line is card only.
 * Never: reads a clock, a store or a model.
 */
import type { Class, Sens } from "../schema/primitives";
import type { ErrandLine, ErrandRead } from "../schema/records";
import { SAFE_NAME_FALLBACK, safeName } from "../safe-name";
import { civilDay } from "../time";
import { cleanErrandText } from "./clean";
import { ERRAND_LINE_CHARS } from "./limits";
import type { CheckedLine, ErrandRefView } from "./result";

/** At most this many senders are named in one spoken line's attribution; a line that cites more is card only. */
export const ERRAND_ATTRIBUTED_SENDERS_MAX = 2;

const TRUST: readonly Class[] = ["U", "C", "O", "T", "M"];
const SENS: readonly Sens[] = ["S0", "S1", "S2"];
const lowerTrust = (a: Class, b: Class): Class => (TRUST.indexOf(b) > TRUST.indexOf(a) ? b : a);
const higherSens = (a: Sens, b: Sens): Sens => (SENS.indexOf(b) > SENS.indexOf(a) ? b : a);
const third = (c: Class) => c === "T" || c === "M";

interface Effective {
  read: ErrandRead;
  cls: Class;
  sens: Sens;
}

/** A read from someone else that the owner has mailed: the only third-party text that may be spoken. */
const mailedThird = (r: Effective): boolean => third(r.cls) && r.read.source.kind === "mail" && r.read.sender !== null && r.read.sender.mailed;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A day word for an instant (review fix E5): today, yesterday, a weekday within the last week, else month and day
 * ("Oct 2"); never an ISO date.
 */
export function errandDayWord(atIso: string, nowMs: number, zone: string): string | null {
  const at = Date.parse(atIso);
  if (!Number.isFinite(at)) return null;
  const day = civilDay(at, zone);
  const today = civilDay(nowMs, zone);
  const yesterday = civilDay(nowMs - 86_400_000, zone);
  if (day.date === today.date) return "today";
  if (day.date === yesterday.date) return "yesterday";
  if (nowMs - at < 6 * 86_400_000 && at <= nowMs) return day.weekday;
  const [, m, d] = day.date.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1] ?? ""} ${d}`.trim();
}
const when = errandDayWord;

/** Review fix T5: an address shown as itself only when it is plainly one; else a neutral stand-in. */
const ADDRESS_LABEL = /^[a-z0-9][a-z0-9._%+'-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z]{2,24}$/;
export const UNKNOWN_ADDRESS_LABEL = "an unknown address";
export const errandAddressLabel = (address: string): string => {
  const a = address.trim().toLowerCase();
  return a.length <= 254 && ADDRESS_LABEL.test(a) ? a : UNKNOWN_ADDRESS_LABEL;
};

const unmailedSender = (r: ErrandRead): boolean => r.sender !== null && !r.sender.mailed;
const nameOf = (r: ErrandRead): string => (unmailedSender(r) ? errandAddressLabel(r.sender!.address) : safeName(r.sender?.name ?? (r.source.kind === "mail" ? r.source.from : "")));
// Review fix V8: one address under two names is two senders, so each is named (or the line is card only).
const keyOf = (r: ErrandRead): string => `${r.sender !== null ? r.sender.address.trim().toLowerCase() : ""}|${nameOf(r)}`;
/** Review fix V8: a sender whose name does not pass `safeName` cannot be named, so its line is card only. */
const nameable = (r: ErrandRead): boolean => !unmailedSender(r) && nameOf(r) !== SAFE_NAME_FALLBACK;

/**
 * Code's attribution for the third-party reads a line cites: "From Dana Park, Tuesday:", "From Dana Park and Pat Lee,
 * today:", "From Dana Park (Tuesday) and Pat Lee (today):"; past two senders, "…and others:". Null with none.
 */
export function errandAttributionFor(reads: readonly ErrandRead[], nowMs: number, zone: string): string | null {
  const mail = reads.filter((r) => r.source.kind === "mail");
  if (mail.length === 0) return reads.length === 0 ? null : "From someone else's invitation:";
  const bySender = new Map<string, ErrandRead>();
  for (const r of mail) if (!bySender.has(keyOf(r))) bySender.set(keyOf(r), r);
  const senders = [...bySender.values()];
  const named = senders.slice(0, ERRAND_ATTRIBUTED_SENDERS_MAX);
  const days = named.map((r) => (r.source.kind === "mail" ? when(r.source.at, nowMs, zone) : null));
  const others = senders.length > ERRAND_ATTRIBUTED_SENDERS_MAX ? " and others" : "";
  if (named.length === 1) return days[0] === null ? `From ${nameOf(named[0]!)}${others}:` : `From ${nameOf(named[0]!)}${others}, ${days[0]}:`;
  const [a, b] = [named[0]!, named[1]!];
  if (days[0] !== null && days[0] === days[1]) return `From ${nameOf(a)}${others === "" ? " and " : ", "}${nameOf(b)}${others}, ${days[0]}:`;
  const part = (r: ErrandRead, d: string | null) => (d === null ? nameOf(r) : `${nameOf(r)} (${d})`);
  return `From ${part(a, days[0]!)}${others === "" ? " and " : ", "}${part(b, days[1]!)}${others}:`;
}

/** The run's lines as they may be said or shown. */
export function taintErrandLines(lines: readonly CheckedLine[], reads: readonly ErrandRead[], views: readonly ErrandRefView[], at: { nowMs: number; zone: string }, opaque = false): ErrandLine[] {
  const view = new Map(views.map((v) => [v.ref, v]));
  const eff = new Map<string, Effective>();
  for (const r of reads) {
    const v = view.get(r.ref);
    const cls = v === undefined || v.cls === null ? r.cls : lowerTrust(r.cls, v.cls);
    const sens = v === undefined || v.cls === null ? r.sens : higherSens(r.sens, v.sens);
    eff.set(r.ref, { read: r, cls, sens });
  }
  const shown = [...eff.values()].filter((e) => e.read.shown);
  const runSens = shown.reduce<Sens>((a, e) => higherSens(a, e.sens), "S0");
  const runCls = shown.reduce<Class>((a, e) => lowerTrust(a, e.cls), "U");
  // `opaque`: a tool read something it could not register, so the planner may have seen text nobody knows.
  const untrusted = opaque || shown.some((e) => third(e.cls) && !mailedThird(e));
  const hasThird = shown.some((e) => third(e.cls));

  const out: ErrandLine[] = [];
  for (const l of lines) {
    const text = cleanErrandText(l.text).slice(0, ERRAND_LINE_CHARS).trim();
    const cited = l.refs.map((r) => eff.get(r)).filter((e): e is Effective => e !== undefined && e.read.shown);
    if (text.length === 0 || cited.length === 0) continue;
    const refs = cited.map((e) => e.read.ref);
    const sens = cited.reduce<Sens>((a, e) => higherSens(a, e.sens), higherSens(l.sens, runSens));
    const citedThird = cited.filter((e) => third(e.cls));
    const attribution = errandAttributionFor(citedThird.map((e) => e.read), at.nowMs, at.zone);
    if (untrusted || hasThird) {
      // Card only, unless every shown third-party read is mail from a mailed sender and this line cites one to
      // name, with at most two senders.
      const senders = new Set(citedThird.map((e) => keyOf(e.read)));
      // Review fix E9: every ref the line cites must be a mailed sender's mail; a mix is card only.
      const speak = !untrusted && citedThird.length > 0 && cited.every(mailedThird) && citedThird.every((e) => nameable(e.read)) && senders.size <= ERRAND_ATTRIBUTED_SENDERS_MAX;
      out.push({ text, refs, cls: lowerTrust(cited.reduce<Class>((a, e) => lowerTrust(a, e.cls), l.cls), runCls), sens, attribution, speak });
      continue;
    }
    // No shown third-party read: the run's own records, spoken as O.
    out.push({ text, refs, cls: lowerTrust(l.cls, "O"), sens, attribution: null, speak: true });
  }
  return out;
}
