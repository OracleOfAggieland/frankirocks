/** The Gate's input and output (brief 024; docs/briefs/024-design.md §1). */
import type { Au, Class, ID, Sens, TS } from "../schema/primitives";
import type { GateCarveOut, GateForm, GateReason, GateRender, GateVerdict, MustSayKind } from "./reasons";

export type GateTrigger = "unprompted" | "recall" | "jarTap";
export type GatePurpose = "item" | "wish" | "ask" | "insight" | "celebrate" | "suggest" | "logistics";
export type GateBuild = "floor" | "plus200";
export type QuietKind = "unsolicited" | "all_output";
export type GateMoment = "opener" | "idle";

export interface GateTopic {
  topicId: ID;
  label: string;
  /** Door labels and terms come only from U, C or O spans (spec §3 "Third-party labels"). */
  labelClass: Class;
  terms: readonly string[];
  /** "Don't bring it up": `unsolicited` lets only an asked recall through; `all_output` denies everything. */
  quiet: QuietKind | null;
}

export interface GateAuthorization {
  subjectId: string;
  topicId: ID | null;
  momentId: ID | null;
  audience: Au;
  expiresAt: TS;
  used: boolean;
  /** The class of the words that granted it. Only U or C counts. */
  sourceClass: Class;
}

/** One memory or moment that might be said. */
export interface GateCandidate {
  id: ID;
  kind: "memory" | "moment";
  subjectId: string;
  sourceClass: Class;
  sens: Sens;
  /** Allergies are exempt from every S2 gate. */
  allergy: boolean;
  /** `eligible` and `spokenGrade` as the caller found them; `gateMemory` computes it. */
  eligibility: { allow: boolean; reason: string };
  /** When the owner volunteered it (world time), for the named check-in. */
  toldAt: TS | null;
  topic: GateTopic | null;
  /**
   * The recall's query terms, as the voice model sent them. They narrow retrieval only and never make a result asked
   * (brief 033 finding 3).
   */
  queryTerms: readonly string[];
  /**
   * The candidate's own names and aliases (its entity's), from U, C or O spans. A recall is asked only when the
   * owner's words hold one of these or open the candidate's topic.
   */
  aliases: readonly string[];
  purpose: GatePurpose;
  gravity: 0 | 1 | 2 | 3;
  food: boolean;
  /** Claimed by the caller; the Gate proves it before using it. */
  mustSay: MustSayKind | null;
  dueAt: TS | null;
  /** Class T only: whether the owner has mailed this sender. */
  sender: { mailedByOwner: boolean } | null;
  attestedPremises: number;
  offerUsed: boolean;
  ownRooted: boolean;
  checkInUsed: boolean;
  /** `use`: the reason may filter suggestions and is never said. */
  act: "say" | "use";
}

export interface GateRecentTurn {
  role: "user" | "assistant";
  checkInAnswer: boolean;
  transitionOrCrisis: boolean;
}

export interface GateContext {
  worldNow: TS;
  zone: string;
  build: GateBuild;
  audience: Au;
  modifiers: { rushed: boolean; crisis: boolean };
  trigger: GateTrigger;
  /**
   * What started an unprompted line (spec §3, the `proactive` row): a Franki-started `opener`, or an `idle` moment in
   * a session. Required on the `unprompted` trigger, else null (brief 033 finding 7).
   */
  moment: GateMoment | null;
  /** This turn's owner words. Asked and doors read them only when the class is U or C and the speaker is certain. */
  ownerTurn: { text: string; sourceClass: Class; certain: boolean } | null;
  openedTopics: readonly ID[];
  /** The Session's recent turns, oldest first. */
  recentTurns: readonly GateRecentTurn[];
  /** The world day's deliveries and this reply's notes. */
  counts: { proactive: number; heavy: number; senderAsks: number; notesThisReply: number };
  rules: "ready" | "missing" | "unreadable";
  authorization: GateAuthorization | null;
}

export interface GateResult {
  verdict: GateVerdict;
  form: GateForm | null;
  render: GateRender | null;
  carveOut: GateCarveOut | null;
  /** The proven floor, when there is one. */
  mustSay: MustSayKind | null;
  /** A fixed line said instead of the candidate (hard rules fail closed). */
  fixedLine: string | null;
  reasons: GateReason[];
}
