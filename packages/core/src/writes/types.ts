/**
 * Types for the on-turn writes of brief 012 (F3): every closed union of the design note's sections 2, 4 and 6
 * (`docs/briefs/012-design.md`). Pure; nothing here reads a clock, a store or a model.
 *
 * Wave A task A2 commits these with stubs that throw `NotBuilt`, so the wave's properties compile and run red.
 * Each later task replaces one stub with the real function; the types are the contract between them.
 */
import type { Hasher } from "../ids";
import type { EID, ID, Pred, Ref, Slice, Span, TS, Value } from "../schema/primitives";
import type { AllergyRule as AllergyRuleSchema, CoreRules, Memory } from "../schema/records";
import type { Infer } from "../schema/v";
import type { W } from "../schema/wire";

/** Thrown by a function wave A has typed but not built yet. */
export class NotBuilt extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`);
    this.name = "NotBuilt";
  }
}

/** One `core/rules.allergies` entry (contracts §1). */
type AllergyRule = Infer<typeof AllergyRuleSchema>;

/** A `dependsOn` entry: `e:<eid>` or `m:<id>@<rev>`. */
type Dep = string;

/** Milliseconds since the epoch on the injected worldClock. */
export type Ms = number;

/** The three on-turn routes. */
export type Route = "hardRule" | "correct" | "transition";

// ---------------------------------------------------------------------------------------------
// 2.3 FastSlotsV1 output (the strict schema's shape, after `Args` pairs are decoded)

export type Act = "direct" | "quoted" | "hypothetical" | "uncertain";
export type Polarity = "affirmed" | "denied" | "uncertain";
export type Severity = "allergy" | "anaphylaxis" | "celiac" | "intolerance" | "unknown";
export type Need = "none" | "subject" | "target" | "meaning" | "speaker" | "time";
export type TransitionKind =
  | "death"
  | "recovery"
  | "illness"
  | "breakup"
  | "reunion"
  | "move"
  | "jobChangeOwn"
  | "jobChangeOther"
  | "scheduledStart"
  | "expire";

/** Strict mode allows no open objects, so `Args` travel as name/value pairs (CQ 122). */
export interface ArgPair {
  name: string;
  value: string | number | boolean | null;
}

/** At most one of the three is set (row SU1). */
export interface Subject {
  entityId: EID | null;
  mention: Span | null;
  isSelf: boolean;
}

export type FastItem =
  | { kind: "allergy"; subject: Subject; item: string; severity: Severity; polarity: Polarity; act: Act; span: Span }
  | { kind: "rule"; subject: Subject; predicate: Pred; value: Value; args: ArgPair[]; whenSpoken: string | null; act: Act; span: Span }
  | { kind: "correction"; targetIds: ID[]; predicate: Pred; replacementValue: Value | null; args: ArgPair[] | null; act: Act; span: Span }
  | {
      kind: "transition";
      transition: TransitionKind;
      subject: Subject;
      counterpart: Subject | null;
      whenSpoken: string | null;
      polarity: Polarity;
      act: Act;
      span: Span;
    };

export interface FastSlotsOut {
  items: FastItem[];
  need: Need;
}

export type FastSlotsResult =
  | { kind: "valid"; out: FastSlotsOut; ms: number }
  | { kind: "invalid"; reason: "refusal" | "incomplete" | "empty" | "notJson" | "shape" | "tooMany" | "oversize"; path: string | null; ms: number }
  | { kind: "timeout"; ms: number }
  | { kind: "transport"; ms: number };

// ---------------------------------------------------------------------------------------------
// 2.4 Validation

/** The turn's Evidence as the validators and planners read it. `text` is the `text` field, LF-normalized. */
export interface TurnEvidence {
  eid: ID;
  rev: number;
  text: string;
  /** The Evidence's `fieldSlices` (class per range: authority is per covering slice). */
  slices: readonly Slice[];
  /** The Evidence's root keys, H(slice) per slice. */
  rootKeys: readonly ID[];
  assertedAt: TS;
}

export type EntityKind = "person" | "pet" | "place" | "organization" | "artifact" | "occasion" | "topic";

/** Every subject code may link to (G7): relation rows of `self`, rule subjects, the rename index. */
export interface SubjectIndex {
  entries: readonly { id: EID; kind: EntityKind; label: string; aliases: readonly string[]; relation: string | null }[];
}

export interface ValidateContext {
  evidence: TurnEvidence;
  source: "asr" | "typed";
  /** G19: typed; or asr, parse committed, uncertainSpeaker < 0.10, no company or quiet candidate. */
  speakerCertain: boolean;
  /** The routes a trigger opened on this turn (3.0). */
  routes: ReadonlySet<Route>;
  /** Set when `Session.allergyAsk` is asked (6.4); `rule` is null for a question Franki asked on its own. */
  answering: { rule: AllergyRule | null } | null;
  known: SubjectIndex;
  entities: readonly { id: EID; label: string; aliases: readonly string[] }[];
  targets: ReadonlyMap<ID, { rev: number; memory: Memory; line: string }>;
  worldNow: Ms;
  hasher: Hasher;
}

export type QuestionKind = "whatItem" | "whoHas" | "isAllergy" | "notListed";

/** A code is a gazetteer ID; "unresolved" is the all-food filter. */
export type AllergyVerdict =
  | { kind: "affirm"; subject: EID; label: string | null; codes: string[]; proof: Span }
  | { kind: "unsure"; subject: EID | null; label: string | null; codes: string[] | "unresolved"; question: QuestionKind; proof: Span | null }
  | { kind: "deny"; subject: EID; scope: "global"; proof: Span }
  | { kind: "deny"; subject: EID; scope: "specific"; codes: string[]; proof: Span }
  | { kind: "deny"; answers: ID; proof: Span }
  | { kind: "pendingKept"; ruleId: ID | null; question: "notListed" | null };

export type CorrectionVerdict =
  | { kind: "correct"; targets: ID[]; value: Value; args: Record<string, unknown> }
  | { kind: "rename"; target: ID; entity: EID; from: string; to: string }
  | { kind: "retract"; targets: ID[] }
  | { kind: "same"; targets: ID[] }
  | { kind: "defer"; why: "need" | "speaker" | "keyUnstable" | "uncertainTarget" | "bounds" | "value" };

export type TransitionVerdict =
  | {
      kind: "change";
      transition: Exclude<TransitionKind, "scheduledStart" | "expire">;
      subject: EID;
      counterpart: EID | null;
      /** worldClock ms of the change: the resolved `whenSpoken`, else the turn's moment. Never after now (T6b). */
      when: Ms;
    }
  | { kind: "careOnly" }
  | { kind: "defer"; why: "need" | "speaker" | "scheduled" | "time" | "employer" | "bounds" };

export type IgnoredReason = "authority" | "span" | "act" | "speaker" | "outOfScope" | "target" | "value";

export type ItemVerdict =
  | { kind: "allergy"; index: number; v: AllergyVerdict }
  | { kind: "correction"; index: number; v: CorrectionVerdict }
  | { kind: "transition"; index: number; v: TransitionVerdict }
  | { kind: "ignored"; index: number; reason: IgnoredReason };

// ---------------------------------------------------------------------------------------------
// 4. The write a turn committed, and the reply note

export type TurnWrite =
  | { kind: "none" }
  | { kind: "committed"; routes: readonly Route[]; note: W | null; deckRaised: boolean }
  | { kind: "kept"; routes: readonly Route[]; note: W | null; cut: boolean };

/** 2.7: the closed pointer templates. None has a slot. */
export type RouteNoteKind =
  | "ruleSaved"
  | "ruleAlready"
  | "ruleKept"
  | "noneSaved"
  | "ask.whatItem"
  | "ask.whoHas"
  | "ask.isAllergy"
  | "ask.notListed"
  | "corrected"
  | "renamed"
  | "retracted";

// ---------------------------------------------------------------------------------------------
// 5. What the route handled, written on the turn's Extract_Job

export interface OnTurnHandled {
  route: Route;
  outcome: HardRuleOutcome["kind"] | "applied" | "renamed" | "retracted" | "same" | "careOnly" | "deferred" | "proposed";
  /** At most 8. */
  keys: ID[];
  /** At most 16. */
  refs: Ref[];
  /** At most 32. */
  ruleKeys: { subjectId: EID | null; code: string }[];
}

// ---------------------------------------------------------------------------------------------
// 6.1 The FastSlots call per request

export type SlotsTrigger = "regex" | "asked" | "candidate";
export type SlotsPhase =
  | { kind: "idle"; regex: boolean; ctx: boolean; asked: boolean; parse: "pending" | "route" | "none" }
  | { kind: "running"; trigger: SlotsTrigger; deadlineAt: number }
  | { kind: "settled"; result: FastSlotsResult }
  | { kind: "notNeeded" };
export type SlotsEvent =
  | { kind: "ready"; asked: boolean; at: number }
  | { kind: "parsed"; route: boolean; at: number }
  | { kind: "answered"; result: FastSlotsResult }
  | { kind: "deadline"; at: number };

// ---------------------------------------------------------------------------------------------
// 6.2 Per-turn hardRule outcome

export type HardRuleOutcome =
  | { kind: "ruleWritten"; ruleIds: ID[] }
  | { kind: "ruleKept"; ruleIds: ID[]; why: "duplicate" | "weaker" | "denied" }
  | { kind: "pendingWritten"; ruleIds: ID[]; question: QuestionKind | null }
  | { kind: "pendingKept"; ruleIds: ID[] }
  | { kind: "pendingResolved"; ruleIds: ID[]; by: "rule" | "denial" }
  | { kind: "denialRecorded"; wrote: "noneConfirmed" | "ledgerOnly" }
  | { kind: "notAllergy" };

/** A ledger decision the hardRule route records; it cites the turn's Evidence. */
export interface LedgerDecision {
  eid: ID;
  outcome: HardRuleOutcome["kind"];
  /** Gazetteer codes the decision is about (a denial's, or an ignored-`speaker` denial's). */
  codes: string[];
}

/** What `planHardRule` knows about the turn besides its verdicts. */
export interface HardRuleTurn {
  evidence: TurnEvidence;
  /** Which triggers opened hardRule on this turn (3.0). */
  trigger: { regex: boolean; candidate: boolean; asked: boolean };
  /** The valid FastSlots answer, or null for a timeout, transport failure or invalid answer. */
  out: FastSlotsOut | null;
  speakerCertain: boolean;
  answering: { rule: AllergyRule | null } | null;
  hasher: Hasher;
}

export interface HardRulePlan {
  rules: CoreRules;
  outcome: HardRuleOutcome;
  note: RouteNoteKind[];
  ledger: LedgerDecision[];
}

// ---------------------------------------------------------------------------------------------
// 6.3 One rule slot

export type RuleSlot = { kind: "absent" } | { kind: "pending"; rule: AllergyRule } | { kind: "active"; rule: AllergyRule };
export type RuleEvent =
  | { kind: "affirm"; proof: Span; deps: Dep[] }
  | { kind: "unsure"; proof: Span | null }
  | { kind: "deny" }
  | { kind: "trustedTap" };

// ---------------------------------------------------------------------------------------------
// 6.4 The open question

export type AllergyAsk =
  | { kind: "none" }
  | { kind: "planned"; ruleId: ID; seq: number }
  | { kind: "asked"; ruleId: ID | null; askedSeq: number; attempts: number };
export type AskEvent =
  | { kind: "ask"; ruleId: ID; seq: number }
  | { kind: "spoken"; seq: number; question: boolean }
  | { kind: "frankiAsked"; seq: number }
  | { kind: "userTurn"; seq: number; final: boolean; slotsValid: boolean }
  | { kind: "ruleGone"; ruleId: ID }
  | { kind: "sessionClosed" };

// ---------------------------------------------------------------------------------------------
// 6.5 Memory status, 6.6 placement, 6.7 the bundle

export type MemoryStatus = Memory["status"];
export type StatusEvent = "correct" | "transition";
export type Placement = "current" | "history" | "scheduled" | "alleged";
export type PlacementChange = "none" | "transition" | "correct";

// ---------------------------------------------------------------------------------------------
// Plans (`plan.ts`): the closed Command subset and what every planner is given

/** One write. `expectRev` is the rev the row must still have (null: the row must not exist yet). */
export type Command =
  | { op: "putMemory"; id: ID; expectRev: number | null; row: Memory }
  | { op: "putRules"; expectRulesRev: number; row: CoreRules }
  | { op: "burnBundle" }
  | { op: "ledger"; decision: LedgerDecision };

export type PlanError = "invalidInput" | "refused" | "staleRevision" | "unsupported" | "budgetExceeded";

/** contracts §7 `Plan = Result<CP>`, narrowed to the Commands F3 writes. A planner writes nothing itself. */
export type Plan = { ok: true; commands: Command[] } | { ok: false; error: PlanError };

/** What `applyCorrection` and `applyTransition` are given besides the verdict and the rows. */
export interface PlanEnv {
  uid: string;
  /** The turn whose words make the change. */
  evidence: TurnEvidence;
  /** The item's verified (anchored) span on `evidence`. */
  proof: Span;
  /** G37: the FastSlots packet's inputs. The planner drops the rows its plan closes from `dependsOn`. */
  lineage: { packetEids: ID[]; contextIds: Ref[]; dependsOn: Dep[] };
  worldNow: TS;
  opsNow: TS;
  nextReviewAt: TS;
  epoch: number;
  policyRev: number;
  hasher: Hasher;
}
