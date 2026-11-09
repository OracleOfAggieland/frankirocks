/**
 * The Admission_Seam (R17.1, R17.4, R17.10; KV02, KV03; design "Admission seam"). `admit` is the only function
 * that creates a Permit. It calls the active implementation (`devAdmit` in this slice) and writes exactly one
 * ledger `decision` entry in the caller's transaction before returning:
 *   Permit  keyed by permitId, state "complete", acceptedRefs [turn]
 *   hold    keyed by H("hold", stamp, requestId), state "blocked", heldRefs [turn]
 * The closed `decision` payload has no issuer or Permit kind field (contract questions 16, 17): the debug route
 * reports issuer "devAdmit" and derives the kind from the stored Turn.
 */
import { type Hasher, type Ledger, type Ref, tsFromMs } from "@franki/core";
import type { Env } from "../config/env";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { type AdmitInput, type AdmitResult, devAdmit } from "./dev-admit";

export interface SeamInput extends AdmitInput {
  uid: string;
  requestId: string;
  turnRef: Ref;
  core: { epoch: number; policyRev: number };
}

export function admit(tx: Tx, input: SeamInput, deps: { env: Env; hasher: Hasher }): AdmitResult {
  // devAdmit throws in production before anything is computed or written.
  const result = devAdmit(input, deps.env, deps.hasher);
  const now = tsFromMs(input.opsNow);
  const entryId = result.kind === "permit" ? result.permit.permitId : deps.hasher.id(["hold", input.stamp, input.requestId]);
  const entry: Extract<Ledger, { kind: "decision" }> = {
    ...cFields(input.uid, now, input.core.epoch, input.core.policyRev),
    kind: "decision",
    state: result.kind === "permit" ? "complete" : "blocked",
    at: now,
    retainUntil: null,
    payload: {
      purpose: "answer",
      acceptedRefs: result.kind === "permit" ? [input.turnRef] : [],
      heldRefs: result.kind === "permit" ? [] : [input.turnRef],
      reasonCodes: result.kind === "permit" ? [] : result.reasonCodes,
      audience: "private",
    },
  };
  tx.create(paths.ledger(input.uid, entryId), entry);
  return result;
}
