/**
 * devAdmit: the development implementation of the Admission_Seam (R17.4–R17.8; KV02, KV03). F2 replaces it with
 * the real judge. It refuses to run while NODE_ENV is "production": it throws CONFIG before computing anything,
 * so no Permit and no ledger entry exist (R17.5). Never loosen this check (R17.6).
 */
import {
  type AdmissionTurn,
  type Hasher,
  type Permit,
  type ReasonCode,
  PERMIT_TTL_MS,
  type PayloadInput,
  devPermitKind,
  idParts,
  payloadHash,
  tsFromMs,
} from "@franki/core";
import { type Env, isProduction } from "../config/env";

export class DevAdmitRefusedError extends Error {
  readonly code = "CONFIG" as const;
  constructor() {
    super("CONFIG: devAdmit does not run in production");
    this.name = "DevAdmitRefusedError";
  }
}

export interface AdmitInput extends PayloadInput {
  turn: AdmissionTurn;
  opsNow: number;
}

export type AdmitResult = { kind: "permit"; permit: Permit } | { kind: "hold"; reasonCodes: ReasonCode[] };

export function devAdmit(input: AdmitInput, env: Env, hasher: Hasher): AdmitResult {
  if (isProduction(env)) throw new DevAdmitRefusedError();
  const { kind, scope } = devPermitKind(input.turn);
  // postCommitControl carries no S1+ note (contracts §6 Permit table); a pasted turn with one is held.
  if (kind === "postCommitControl" && input.notes.some((n) => n.sens !== "S0")) return { kind: "hold", reasonCodes: ["sensitivity"] };
  // recoveryOnly plays only the fixed neutral line: no notes, no tools.
  if (kind === "recoveryOnly" && (input.notes.length > 0 || input.toolOutput !== null)) return { kind: "hold", reasonCodes: ["ineligible"] };
  const approvedPayloadHash = payloadHash(input, hasher);
  const permit: Permit = {
    permitId: hasher.id(idParts.permit(input.stamp, kind, approvedPayloadHash)),
    stamp: input.stamp,
    kind,
    scope,
    approvedPayloadHash,
    noteIds: input.notes.map((n) => n.noteId).slice(0, 4),
    momentIds: [],
    expiresAt: tsFromMs(input.opsNow + PERMIT_TTL_MS),
  };
  return { kind: "permit", permit };
}
