import { isHeartbeatFresh } from "@franki/core";

export type CheckName = "firestore" | "openaiModel" | "realtimeMint" | "heartbeat";

export interface CheckResult {
  ok: boolean;
  ms: number;
  detail?: string;
}

export interface HealthReport {
  ok: boolean;
  checkedAt: string;
  checks: Record<CheckName, CheckResult>;
}

export interface Heartbeat {
  atMs: number;
  openaiOk: boolean;
  kmsOk: boolean;
}

/** Everything the deep health check touches, injected so tests can use fakes instead of real services. */
export interface HealthDeps {
  now(): number;
  /** Writes a nonce to Firestore and returns whether reading it back matched. */
  firestoreRoundTrip(): Promise<boolean>;
  /** Returns the id of the model OpenAI reports for `model`. */
  retrieveModel(model: string): Promise<string>;
  /** Mints a short-lived Realtime client secret without opening a session. */
  mintRealtimeClientSecret(model: string): Promise<string>;
  readHeartbeat(): Promise<Heartbeat | null>;
}

export interface HealthConfig {
  brainModel: string;
  voiceModel: string;
}

type Outcome = Omit<CheckResult, "ms">;

const KEY_LIKE = /\b(?:sk|ek|rk)[-_][\w*.-]{4,}/g;
const MAX_DETAIL = 200;

/** Replaces anything shaped like an OpenAI key or client secret. */
export function redactSecrets(text: string): string {
  return text.replace(KEY_LIKE, "[redacted]");
}

export async function runDeepHealth(deps: HealthDeps, config: HealthConfig): Promise<HealthReport> {
  const [firestore, openaiModel, realtimeMint, heartbeat] = await Promise.all([
    timed(deps, async () => ((await deps.firestoreRoundTrip()) ? pass() : fail("read-back mismatch"))),
    timed(deps, async () => {
      const id = await deps.retrieveModel(config.brainModel);
      return id === config.brainModel ? pass(id) : fail(`unexpected model ${id}`);
    }),
    timed(deps, async () => {
      // The minted secret never leaves this function; only its shape is checked.
      const secret = await deps.mintRealtimeClientSecret(config.voiceModel);
      return secret.startsWith("ek_") ? pass(config.voiceModel) : fail("unexpected client secret format");
    }),
    timed(deps, async () => {
      const beat = await deps.readHeartbeat();
      if (!beat) return fail("no heartbeat yet");
      if (!isHeartbeatFresh(beat.atMs, deps.now())) return fail("heartbeat is stale");
      if (!beat.openaiOk || !beat.kmsOk) return fail(`openaiOk=${beat.openaiOk} kmsOk=${beat.kmsOk}`);
      return pass();
    }),
  ]);
  const checks = { firestore, openaiModel, realtimeMint, heartbeat };
  return {
    ok: Object.values(checks).every((check) => check.ok),
    checkedAt: new Date(deps.now()).toISOString(),
    checks,
  };
}

async function timed(deps: HealthDeps, run: () => Promise<Outcome>): Promise<CheckResult> {
  const start = deps.now();
  try {
    const outcome = await run();
    return { ...outcome, ms: deps.now() - start };
  } catch (error) {
    return { ok: false, ms: deps.now() - start, detail: describeError(error) };
  }
}

function pass(detail?: string): Outcome {
  return detail === undefined ? { ok: true } : { ok: true, detail: clip(detail) };
}

function fail(detail: string): Outcome {
  return { ok: false, detail: clip(detail) };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    const prefix = typeof status === "number" ? `HTTP ${status}: ` : `${error.name}: `;
    return clip(prefix + error.message);
  }
  return clip(String(error));
}

function clip(text: string): string {
  return redactSecrets(text).slice(0, MAX_DETAIL);
}
