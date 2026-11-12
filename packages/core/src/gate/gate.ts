/**
 * The Gate (brief 024; spec §6; contracts §2 and §7 `gate`). A pure decision over one candidate and its context:
 * say, card, hold or silent, with the form, the render, any carve-out and closed reason codes. It runs before any
 * speaking model sees the text. The rules are in docs/briefs/024-design.md.
 *
 * Always: the result is never more open than the candidate's cell of `CEILING`; every modifier only lowers it; S2
 * (allergies excepted) is said or carded only through a logged carve-out; a quiet topic is never brought up; a food
 * candidate without rule data is never said. Never: reads a clock, a store or a model, or throws.
 */
import { isPlainObject } from "../schema/v";
import { msFromTs } from "../schema/primitives";
import { CEILING, PLUS200_PATHS, type CeilingPath, classGroup } from "./ceiling";
import { askedByOwner, doorOpens, topicOpen } from "./doors";
import { inQuietHours } from "./quiet-hours";
import { GATE_VERDICTS, type GateReason, type GateVerdict, type MustSayKind } from "./reasons";
import type { GateCandidate, GateContext, GateResult } from "./types";

export const HARD_RULE_FAIL_LINE = "Allergy data unavailable, recommend no food.";

/** Spec §5 "Three proactive a day, one heavy." */
export const PROACTIVE_PER_DAY = 3;
export const HEAVY_PER_DAY = 1;
export const HEAVY_GRAVITY = 2;
/** Contracts §2 "Q<=1/sender/day(ASSUMED)". */
export const T_ASKS_PER_SENDER_PER_DAY = 1;
/** Spec §6 "two attested premises allow one offer". */
export const OFFER_PREMISES = 2;
/** Spec §6 "One named check-in if volunteered within 7 days". */
export const CHECK_IN_WINDOW_MS = 7 * 86_400_000;
/** Spec §6 floors: "a commitment due within 24 hours"; contracts §2 T logistics "<=24h". */
export const MUST_SAY_WINDOW_MS = 86_400_000;
/** Spec §5: no insight, celebrate or ask "within two turns of a check-in answer". */
export const CHECK_IN_QUIET_TURNS = 2;

const rank = (v: GateVerdict) => GATE_VERDICTS.length - GATE_VERDICTS.indexOf(v);

function result(verdict: GateVerdict, reasons: GateReason[], extra: Partial<GateResult> = {}): GateResult {
  return { verdict, form: null, render: null, carveOut: null, mustSay: null, fixedLine: null, reasons, ...extra };
}

/** Lowers `r` to `v` when `v` is less open; a card keeps its form and carve-out, a hold or silent keeps neither. */
function lower(r: GateResult, v: GateVerdict, reason: GateReason): GateResult {
  if (rank(v) >= rank(r.verdict)) return r;
  const reasons: GateReason[] = [...r.reasons.filter((x) => x !== "ok"), reason];
  if (v === "card") return { ...r, verdict: v, render: null, reasons };
  return { ...r, verdict: v, form: null, render: null, carveOut: null, reasons };
}

const ts = (t: unknown): number | null => {
  if (typeof t !== "string") return null;
  const ms = msFromTs(t);
  return Number.isFinite(ms) ? ms : null;
};

/** The floor kind, only when code can prove it (spec §6 "Floors"). */
function provenMustSay(c: GateCandidate, now: number): MustSayKind | null {
  if (c.mustSay === null) return null;
  // A hard-rule conflict is flagged by the food filter, so only a food candidate carries one.
  if (c.mustSay === "hardRuleConflict") return c.food === true ? "hardRuleConflict" : null;
  const due = ts(c.dueAt);
  if (due === null || due < now || due - now > MUST_SAY_WINDOW_MS) return null;
  // A commitment is the owner's own; critical logistics are a third party's arrival, departure or cancellation.
  if (c.mustSay === "commitmentDue" && (c.sourceClass === "U" || c.sourceClass === "C")) return "commitmentDue";
  if (c.mustSay === "criticalLogistics" && c.purpose === "logistics" && c.sourceClass === "T") return "criticalLogistics";
  return null;
}

/** One unprompted path of the cell; null when its condition does not hold. */
function tryPath(p: CeilingPath, c: GateCandidate, x: GateContext, now: number): GateResult | null {
  if (PLUS200_PATHS.has(p) && (x.build !== "plus200" || x.audience !== "private")) return null;
  switch (p) {
    case "open":
      return result("say", ["ok"], { form: "item", render: "free" });
    case "attributedMailed":
      return c.sender?.mailedByOwner === true ? result("say", ["ok"], { form: "item", render: "attributed" }) : null;
    case "attributedLogistics":
      // "T unprompted=mailed sender/type only, else card" (contracts §2).
      return c.purpose === "logistics" && c.sender?.mailedByOwner === true ? result("say", ["ok"], { form: "item", render: "attributed" }) : null;
    case "cappedAsk":
      // Q: an ask only to a known sender, at most one a day.
      if (c.purpose !== "ask" || c.sender?.mailedByOwner !== true) return null;
      return x.counts.senderAsks < T_ASKS_PER_SENDER_PER_DAY ? result("say", ["ok"], { form: "item", render: "attributed" }) : result("card", ["senderCap"], { form: "item" });
    case "card":
      return result("card", ["ceiling"], { form: "item" });
    case "offer":
      return c.attestedPremises >= OFFER_PREMISES && !c.offerUsed ? result("say", ["ok"], { form: "item", render: "offer" }) : null;
    case "checkIn": {
      const told = ts(c.toldAt);
      if (c.checkInUsed || told === null || told > now || now - told > CHECK_IN_WINDOW_MS) return null;
      return result("say", ["ok", "carveOut"], { form: "checkIn", render: "template", carveOut: "checkIn" });
    }
    case "door":
      return c.topic !== null ? result("say", ["ok", "carveOut"], { form: "door", render: "template", carveOut: "door" }) : null;
    case "ownRootedDoor":
      return c.ownRooted && c.topic !== null ? result("say", ["ok", "carveOut"], { form: "door", render: "template", carveOut: "door" }) : null;
    case "oLogistics":
      return c.purpose === "logistics" ? result("say", ["ok", "carveOut"], { form: "item", render: "template", carveOut: "oLogistics" }) : null;
    case "replyOnly":
      return result("hold", ["ceiling"]);
    case "silentUntilRaised":
      return result("silent", ["ceiling"]);
    default:
      p satisfies never;
      return null;
  }
}

/** Exact authorization (+200 only): a private U/C grant for this subject, topic and moment, unused and unexpired. */
function authorized(c: GateCandidate, x: GateContext, now: number): boolean {
  const a = x.authorization;
  if (a === null || x.build !== "plus200") return false;
  if (a.sourceClass !== "U" && a.sourceClass !== "C") return false;
  const g = classGroup(c.sourceClass);
  if (g !== "told" && g !== "own") return false;
  const exp = ts(a.expiresAt);
  return (
    !a.used &&
    exp !== null &&
    now < exp &&
    a.audience === "private" &&
    x.audience === "private" &&
    a.subjectId === c.subjectId &&
    a.topicId === (c.topic?.topicId ?? null) &&
    a.momentId === c.id
  );
}

function wellFormed(c: unknown, x: unknown): boolean {
  if (!isPlainObject(c) || !isPlainObject(x)) return false;
  const k = c as unknown as GateCandidate;
  const y = x as unknown as GateContext;
  return (
    ["U", "C", "O", "T", "M"].includes(k.sourceClass) &&
    ["S0", "S1", "S2"].includes(k.sens) &&
    isPlainObject(k.eligibility) &&
    Array.isArray(k.queryTerms) &&
    ["private", "company", "unknown"].includes(y.audience) &&
    ["unprompted", "recall", "jarTap"].includes(y.trigger) &&
    isPlainObject(y.modifiers) &&
    isPlainObject(y.counts) &&
    Array.isArray(y.openedTopics) &&
    Array.isArray(y.recentTurns) &&
    ts(y.worldNow) !== null
  );
}

export function gate(c: GateCandidate, x: GateContext): GateResult {
  if (!wellFormed(c, x)) {
    const food = isPlainObject(c) && (c as { food?: unknown }).food !== false;
    return result("silent", ["invalidInput"], { fixedLine: food ? HARD_RULE_FAIL_LINE : null });
  }
  const now = ts(x.worldNow)!;

  // Hard rules fail closed: with rule data unavailable, no food at all, and the fixed line instead.
  if (c.food !== false && x.rules !== "ready") return result("silent", ["rulesUnavailable"], { fixedLine: HARD_RULE_FAIL_LINE });
  if (c.eligibility.allow !== true) return result("silent", ["ineligible"]);
  if (c.act === "use") return result("silent", ["useOnly"], { form: "use" });

  const quiet = c.topic?.quiet ?? null;
  if (quiet === "all_output") return result("silent", ["quiet"]);
  const asked = askedByOwner(c, x);
  // "Otherwise the notes come back empty."
  if (x.trigger === "recall" && !asked) return result("silent", ["notAsked"]);
  // "Don't bring it up" wins over every authorization; only an asked recall passes it.
  if (quiet === "unsolicited" && x.trigger === "unprompted") return result("silent", ["quiet"]);

  const mustSay = provenMustSay(c, now);
  const sens = c.allergy && c.sens === "S2" ? "S1" : c.sens;
  const opened = topicOpen(c, x);
  // A guess is raised only by this turn's own words (contracts §2 M "R": a user query term or alias), never by a
  // topic opened earlier in the Session.
  const raised = asked || (c.sourceClass === "M" ? c.topic !== null && doorOpens(c.topic, x) : opened);
  const cell = CEILING[sens][classGroup(c.sourceClass)];

  // The cell's answer.
  let r: GateResult;
  if (x.trigger === "jarTap") {
    r = result("card", ["ok", "carveOut"], { form: "item", carveOut: "jarTap" });
  } else if (sens === "S2" && authorized(c, x, now)) {
    r = result("say", ["ok", "authorization", "carveOut"], { form: "item", render: "template", carveOut: "authorization" });
  } else {
    r = result("silent", ["ceiling"]);
    for (const p of cell.paths) {
      const found = tryPath(p, c, x, now);
      if (found !== null) {
        r = found;
        break;
      }
    }
    if (r.verdict !== "say" && raised) {
      // Reply-only: full help once the owner opens the topic. S2 crosses only as an opened-topic owner recall.
      const carve = sens === "S2" && x.trigger === "recall" && asked && opened ? "openedTopicRecall" : null;
      r = result("say", ["ok", asked ? "asked" : "topicOpen", ...(carve !== null ? (["carveOut"] as const) : [])], {
        form: "item",
        render: cell.reply,
        carveOut: carve,
      });
    }
  }
  if (mustSay !== null) r = { ...r, mustSay, reasons: [...r.reasons, "mustSay"] };
  else if (c.mustSay !== null) r = { ...r, reasons: [...r.reasons, "mustSayUnproven"] };

  // S2 stays off the wire without a logged carve-out.
  if (sens === "S2" && r.carveOut === null) r = lower(r, "hold", "sensitivity");

  // Audience: modifiers only subtract.
  if (x.audience === "company") {
    if (sens !== "S0" || c.sourceClass === "T") {
      const onScreen = asked || x.trigger === "jarTap" || mustSay === "hardRuleConflict";
      r = lower(r, onScreen ? "card" : "hold", "audience");
    }
    if (r.form === "door") r = lower(r, "hold", "doorsOff");
  } else if (x.audience === "unknown") {
    if (sens === "S2") r = lower(r, "hold", "audience");
    else if (sens === "S1" && r.verdict === "say" && r.render === "free") r = { ...r, render: "template" };
  }
  if (x.modifiers.rushed === true) {
    if (x.counts.notesThisReply >= 1 || r.form === "door" || c.purpose === "insight") r = lower(r, "hold", "rushed");
  }
  if (x.modifiers.crisis === true) {
    // Crisis holds every unprompted line, floors included: a floor bypasses caps, nothing else (spec §6 "Floors").
    if (c.purpose === "suggest" || c.purpose === "celebrate" || x.trigger === "unprompted") r = lower(r, "hold", "crisis");
  }

  // Delivery limits on unprompted saying. A proven floor skips the caps and quiet hours only (contracts §2 "mustSay
  // skips both"); the transition and check-in holds still apply.
  if (x.trigger === "unprompted") {
    if (mustSay === null) {
      if (inQuietHours(now, x.zone)) r = lower(r, "hold", "quietHours");
      if (x.counts.proactive >= PROACTIVE_PER_DAY) r = lower(r, "hold", "cap");
      if (c.gravity >= HEAVY_GRAVITY && x.counts.heavy >= HEAVY_PER_DAY) r = lower(r, "hold", "heavyCap");
    }
    if (c.purpose === "insight" || c.purpose === "celebrate" || c.purpose === "ask") {
      if (x.recentTurns.some((t) => t.transitionOrCrisis)) r = lower(r, "hold", "transition");
      if (x.recentTurns.slice(-CHECK_IN_QUIET_TURNS).some((t) => t.checkInAnswer)) r = lower(r, "hold", "afterCheckIn");
    }
  }
  return r;
}
