/**
 * The Gate for delivery (brief 036 finding 3, the lead's ruling): `chooseNow` runs the Gate for every candidate, with
 * the unprompted trigger, the session's audience and modifiers, and the source's class and sensitivity, so no route
 * can forget it. These build the Gate's input for one opened moment. A field the floor has no source for is set the
 * way that fails closed: no topic, no aliases, no sender the owner has mailed, no premises.
 */
import {
  type Au,
  type ClockPair,
  type CoreDocs,
  type DeliveryMode,
  type Evidence,
  type GateCandidate,
  type GateContext,
  type GateRecentTurn,
  type ID,
  type Ledger,
  type Memory,
  type Moment,
  type Sens,
  type SessionHolds,
  holdsOf,
  isMustSay,
  msFromTs,
  parseDep,
  tsFromMs,
} from "@franki/core";
import { paths } from "../store/paths";
import type { Reader } from "../store/port";

const SENS_ORDER: readonly Sens[] = ["S0", "S1", "S2"];
const maxSens = (a: Sens, b: Sens): Sens => (SENS_ORDER.indexOf(a) >= SENS_ORDER.indexOf(b) ? a : b);
const gravityOf = (g: number): 0 | 1 | 2 | 3 => (g >= 3 ? 3 : g <= 0 ? 0 : (Math.floor(g) as 1 | 2));

/** What a moment asks the Gate for, by kind. */
export function gatePurposeOf(kind: Moment["kind"]): GateCandidate["purpose"] {
  switch (kind) {
    case "wish":
      return "wish";
    case "insight":
      return "insight";
    case "celebrate":
      return "celebrate";
    case "ask":
    case "expiryAsk":
    case "griefAsk":
      return "ask";
    default:
      return "item";
  }
}

interface SourceFacts {
  sourceClass: GateCandidate["sourceClass"];
  sens: Sens;
  gravity: number;
  toldAt: string | null;
}

/** The facts of the row a moment speaks for, or null when it can't be read (the caller drops the moment). */
async function sourceFacts(r: Reader, uid: string, m: Moment): Promise<SourceFacts | null> {
  if (m.memoryId !== null) {
    const id = m.payload.kind === "cue" && m.payload.noteRef.type === "memory" ? m.payload.noteRef.id : m.memoryId;
    const row = (await r.get<Memory>(paths.memory(uid, id)))?.data ?? null;
    if (row === null) return null;
    return { sourceClass: row.sourceClass, sens: row.sens, gravity: row.gravity, toldAt: row.sourceClass === "U" || row.sourceClass === "C" ? row.assertedAt : null };
  }
  // The hero rollup: the owner's own money rows (spec §6: own-account, S1 for bank and category totals).
  if (m.rollupId !== null) return { sourceClass: "O", sens: "S1", gravity: 0, toldAt: null };
  if (m.actionId !== null) {
    const action = (await r.get<Ledger>(paths.ledger(uid, m.actionId)))?.data ?? null;
    if (action === null || action.kind !== "action") return null;
    // The reminder is the owner's own confirmed request (a plain U yes), as sensitive as the rows it came from.
    let sens: Sens = "S0";
    let gravity = 0;
    for (const dep of action.dependsOn) {
      const parsed = parseDep(dep);
      if (parsed === null) return null;
      if (parsed.collection === "memories") {
        const row = (await r.get<Memory>(paths.memory(uid, parsed.id)))?.data ?? null;
        if (row === null) return null;
        sens = maxSens(sens, row.sens);
        gravity = Math.max(gravity, row.gravity);
      } else {
        const e = (await r.get<Evidence>(paths.evidence(uid, parsed.id)))?.data ?? null;
        if (e === null) return null;
        for (const s of e.fieldSlices) sens = maxSens(sens, s.sens);
      }
    }
    return { sourceClass: "U", sens, gravity, toldAt: action.at };
  }
  return null;
}

/**
 * The Gate candidate for one opened moment, read now. A due confirmed reminder claims `commitmentDue` with its due
 * time no earlier than now, since a commitment that has come due is still due (ruling S-186 in docs/briefs/023-design.md).
 */
export async function gateCandidateOf(r: Reader, uid: string, momentId: ID, m: Moment, worldNow: number): Promise<GateCandidate | null> {
  const f = await sourceFacts(r, uid, m);
  if (f === null) return null;
  const due = msFromTs(m.dueAt);
  const mustSay = isMustSay(m.kind, due, worldNow);
  return {
    id: momentId,
    kind: "moment",
    subjectId: m.subjectIds[0] ?? "self",
    sourceClass: f.sourceClass,
    sens: f.sens,
    allergy: false,
    // The moment's source was reread `ok` (eligible at stage speech, unheld) before this is asked.
    eligibility: { allow: true, reason: "ok" },
    toldAt: f.toldAt,
    topic: null,
    queryTerms: [],
    aliases: [],
    purpose: gatePurposeOf(m.kind),
    gravity: gravityOf(f.gravity),
    food: false,
    mustSay: mustSay ? "commitmentDue" : null,
    dueAt: mustSay ? tsFromMs(Math.max(due, worldNow)) : m.dueAt,
    sender: f.sourceClass === "T" ? { mailedByOwner: false } : null,
    attestedPremises: 0,
    offerUsed: false,
    ownRooted: false,
    checkInUsed: false,
    act: "say",
  };
}

/** The session's Gate signals beside delivery's. Unset, the audience is `unknown` and nobody is rushed. */
export interface GateSignals {
  audience?: Au;
  rushed?: boolean;
}

/** The recent turns the Gate reads, rebuilt from delivery's signals. */
function recentTurnsOf(holds: { transition: boolean; crisis: boolean }, turnsSinceCheckInAnswer: number | null): GateRecentTurn[] {
  const turns: GateRecentTurn[] = [];
  if (holds.transition || holds.crisis) turns.push({ role: "user", checkInAnswer: false, transitionOrCrisis: true });
  if (turnsSinceCheckInAnswer !== null) {
    turns.push({ role: "user", checkInAnswer: true, transitionOrCrisis: false });
    for (let i = 0; i < Math.min(turnsSinceCheckInAnswer, 8); i++) turns.push({ role: "user", checkInAnswer: false, transitionOrCrisis: false });
  }
  return turns;
}

/** The Gate's context for an unprompted line now: an `opener` for a session opening, `idle` for a whisper. */
export function gateContextOf(
  core: { counters: { data: CoreDocs["counters"] } },
  pair: ClockPair,
  mode: DeliveryMode,
  signals: SessionHolds & GateSignals & { turnsSinceCheckInAnswer: number | null },
  today: { proactive: number; heavy: number },
): GateContext {
  const holds = holdsOf(signals);
  void core;
  return {
    worldNow: tsFromMs(Number.isFinite(pair.worldClock.now) ? pair.worldClock.now : 0),
    zone: pair.worldClock.zone,
    build: "floor",
    audience: signals.audience ?? "unknown",
    modifiers: { rushed: signals.rushed ?? false, crisis: holds.crisis },
    trigger: "unprompted",
    moment: mode.kind === "opening" ? "opener" : "idle",
    ownerTurn: null,
    openedTopics: [],
    recentTurns: recentTurnsOf(holds, signals.turnsSinceCheckInAnswer),
    counts: { proactive: today.proactive, heavy: today.heavy, senderAsks: 0, notesThisReply: 0 },
    rules: "ready",
    authorization: null,
  };
}
