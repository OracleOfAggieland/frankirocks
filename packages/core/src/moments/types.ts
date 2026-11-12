/**
 * Moment plans (brief 023; contracts "derive by kind"). A plan is what derive wants a moment row to say; the merge
 * decides whether a stored row changes. Plans never carry a Memory: time can only ask.
 */
import type { DOMAINS, EID, Ref, Slice } from "../schema/primitives";
import type { MomentKind, MomentPayload } from "../schema/records";

export type MomentSource = { kind: "memory"; id: string } | { kind: "rollup"; id: string } | { kind: "action"; id: string };

export interface MomentPlan {
  momentId: string;
  source: MomentSource;
  kind: MomentKind;
  /** The original civil start (or civil date) of the occurrence. */
  occurrenceKey: string;
  scheduleRev: number;
  dueAt: number;
  closeAt: number;
  domain: (typeof DOMAINS)[number] | null;
  subjectIds: EID[];
  payload: MomentPayload;
  /** The current row the moment speaks for (a moved occasion's newest Memory). */
  noteRef: Ref | null;
  lineage: { rootKeys: string[]; rootSlices: Slice[]; dependsOn: string[] };
}

export interface DeriveResult {
  plans: MomentPlan[];
  /** Moment IDs this source would own that must not stay pending (a wish at or after its start). */
  retired: string[];
}

export const NO_MOMENTS: DeriveResult = { plans: [], retired: [] };
