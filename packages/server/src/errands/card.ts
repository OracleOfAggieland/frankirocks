/**
 * Brief 049 part A, ruling 11: an Errand's card. Each line the Gate lets show, with code's attribution, then each
 * source behind those lines: sender, subject and date for mail; title and time for an event. No links, and no text
 * from a message other than its subject and the helper's line.
 */
import { type Au, type Card, ERRAND_LABEL_CHARS, ERRAND_UNMAILED_MARKER, type Errand, type ErrandRead, type ErrandSource, type ID, type Ref, type Sens, aboutPhrase, cleanErrandText, errandAddressLabel, safeName } from "@franki/core";
import type { LineVerdict } from "./gate";

const SENS: readonly Sens[] = ["S0", "S1", "S2"];
/** A card holds at most 8 lines: the result's lines first, then their sources. */
const CARD_LINES_MAX = 8;

function when(at: string, zone: string, withTime: boolean): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const opts: Intl.DateTimeFormatOptions = withTime ? { timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { timeZone: zone, weekday: "short", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(ms));
}

/**
 * One source as a card line. Review fix V3: the subject and title are cleaned here too, however they were stored.
 * Review fix T5: a sender the owner hasn't mailed shows as their address and the date only.
 */
export function sourceLine(s: ErrandSource, zone: string, sender: ErrandRead["sender"] = null): string {
  if (s.kind === "mail" && sender !== null && !sender.mailed) return `${errandAddressLabel(sender.address)} · ${when(s.at, zone, false)}`;
  if (s.kind === "mail") {
    const subject = cleanErrandText(s.subject).slice(0, ERRAND_LABEL_CHARS);
    return `${safeName(s.from)} · ${subject.length === 0 ? "(no subject)" : subject} · ${when(s.at, zone, false)}`;
  }
  const title = cleanErrandText(s.title).slice(0, ERRAND_LABEL_CHARS);
  return `${title.length === 0 ? "(no title)" : title} · ${s.allDay ? `${when(s.startsAt, zone, false)}, all day` : when(s.startsAt, zone, true)}`;
}

/** Review fix T4: the planner was shown a third party's message or invite that isn't from a sender the owner mailed. */
export const readStrangers = (reads: readonly ErrandRead[]): boolean =>
  reads.some((r) => r.shown && (r.cls === "T" || r.cls === "M") && !(r.source.kind === "mail" && r.sender !== null && r.sender.mailed));

/**
 * Whether a line's verdict puts it on the card for this audience. Review fix T9: delivery asks the same question
 * before it says "It's on your screen".
 */
export function cardShows(v: Pick<LineVerdict, "shown" | "line">, audience: Au | undefined): boolean {
  const company = audience !== "private";
  return v.shown !== "none" && v.line.sens !== "S2" && (!company || (v.line.sens === "S0" && v.line.cls !== "T" && v.line.cls !== "M"));
}

/** The card, or null when no line may show. */
export function errandCard(errand: Errand, verdicts: readonly LineVerdict[], x: { id: ID; zone: string; audience?: Au }): Card | null {
  // S2 never goes on the wire (KC09), on a card or anywhere else. Review fix V5: outside private (and when the
  // audience isn't given, which fails closed) only S0 lines that rest on no third party's text show.
  const shown = verdicts.filter((v) => cardShows(v, x.audience));
  if (shown.length === 0) return null;
  const lines = shown.map((v) => (v.line.attribution === null ? v.line.text : `${v.line.attribution} ${v.line.text}`));
  const refs = [...new Set(shown.flatMap((v) => v.line.refs))];
  const reads = refs.map((r) => errand.reads.find((x) => x.ref === r)).filter((r) => r !== undefined);
  // Review fix T4: a run shown someone the owner hasn't written to says so, once.
  if (readStrangers(errand.reads)) lines.push(ERRAND_UNMAILED_MARKER);
  for (const r of reads) if (lines.length < CARD_LINES_MAX) lines.push(sourceLine(r!.source, x.zone, r!.sender));
  const sens = shown.reduce<Sens>((a, v) => (SENS.indexOf(v.line.sens) > SENS.indexOf(a) ? v.line.sens : a), "S0");
  const sources: Ref[] = reads.slice(0, 32).map((r) => ({ type: "evidence", id: r!.evidenceId, rev: r!.rev }));
  const title = `From ${aboutPhrase(errand.about)}`;
  return { id: x.id, kind: "source", title, lines: lines.map((l) => l.slice(0, 512)), sources, sens };
}
