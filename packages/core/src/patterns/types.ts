/**
 * Inputs and outputs of the money patterns (contracts §7 Money, `PatternResult` and `LoopResult`). Rows arrive as
 * the Evidence ID, its root key and its typed Observation, so the pure code never reads a store.
 */
import type { Cov, Observation } from "../schema/primitives";
import type { LoopWindow } from "../schema/records";

export type BankObs = Extract<Observation, { kind: "bank" }>;
export type ReceiptObs = Extract<Observation, { kind: "receipt" }>;
export type CalendarObs = Extract<Observation, { kind: "calendar" }>;

export interface BankRow {
  id: string;
  rootKey: string;
  bank: BankObs;
}
export interface ReceiptRow {
  id: string;
  rootKey: string;
  receipt: ReceiptObs;
}
export interface MeetingRow {
  id: string;
  rootKey: string;
  calendar: CalendarObs;
}

/** The window asked for: civil dates, both inclusive, in one zone and one currency. */
export interface WindowAsk {
  fromCivil: string;
  toCivil: string;
  zone: string;
  currency: string;
}

export interface PatternInput {
  purchases: readonly BankRow[];
  receipts: readonly ReceiptRow[];
  events: readonly MeetingRow[];
  bankCoverage: Cov;
  calendarCoverage: Cov;
  window: WindowAsk;
}

export type ExcludeReason = "pending" | "removed" | "unposted" | "category" | "currency" | "amount" | "duplicate" | "refundOrphan" | "netZero" | "timeUnknown" | "outsideWindow" | "uncovered";

export interface PatternResult {
  associationOnly: true;
  detectorVersion: "takeout_late_meeting_v1";
  status: "eligible" | "insufficient" | "partial";
  associationUnit: "night" | "day";
  totalCents: number;
  orderCount: number;
  lateCents: number;
  lateOrderCount: number;
  mostly: boolean;
  window: LoopWindow;
  coveredDates: number;
  /** The orders on late-meeting dates (originals only; their refunds are in `lateRefundIds`). */
  latePurchaseIds: string[];
  lateRefundIds: string[];
  /** The accepted, timed, busy evening meetings on the dates of late orders. */
  meetingIds: string[];
  /** The receipts whose order time enriched a counted order. */
  receiptIds: string[];
  rootKeys: string[];
  excluded: { id: string; reason: ExcludeReason }[];
}

export type LoopStatus = "waiting" | "incomplete" | "noChange" | "eligible" | "cancelled";

export interface LoopResult {
  associationOnly: true;
  status: LoopStatus;
  metric: "takeoutSpend" | "totalFoodSpend" | "userAppraisal";
  beforeCents: number | null;
  afterCents: number | null;
  deltaCents: number | null;
  claim: "categoryLess" | "netReductionScoped" | "userAppraisal" | "none";
  /** The bank rows counted in each window, refunds included. */
  beforeIds: string[];
  afterIds: string[];
  rootKeys: string[];
  /** Why a comparison says nothing, when it doesn't. */
  why: null | "beforeCheckAt" | "lengthDiffers" | "weekdayMix" | "currency" | "uncovered" | "baselineMoved" | "rowsExcluded" | "cancelled" | "notImproved";
  /** Dates in each window (both inclusive). */
  windowDates: number;
}
