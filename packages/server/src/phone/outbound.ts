import { type Ledger, type Session, type Stamp, type Turn, msFromTs, tsFromMs } from "@franki/core";
import { ConfigError } from "../config/env";
import { readCoreDocs } from "../core-docs";
import { currentStamp, sameStamp } from "../deck";
import { cFields } from "../records";
import { inFlightError } from "../routes/errors";
import type { RouteContext } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { StorePort, Tx } from "../store/port";
import { DialRejected, E164, dialTwilio, phoneConfig } from "./twilio";

export type PhoneEntry = Extract<Ledger, { kind: "phoneCall" }>;
export const SIP_WINDOW_MS = 10 * 60_000;
export const queued = "Twilio accepted the call request.";
const unknown = "I couldn’t confirm whether Twilio received the call request.";
const rejected = "Twilio declined the call request. Check the caller ID and voice dialing permissions.";

/** Extract a single number from the requesting user's words, including spoken digits. */
export function destination(text: string, from: string): string | null {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const digits = text.toLowerCase().replace(/\bplus\s+(?=\d|zero|one|two|three|four|five|six|seven|eight|nine)/g, "+")
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|oh)\b/g, (w) => String(w === "oh" ? 0 : words.indexOf(w)));
  const candidates = [...digits.matchAll(/(?:\+\s*)?\(?\d(?:[\s().-]*\d){6,}/g)];
  if (candidates.length !== 1) return null;
  const raw = candidates[0]![0].replace(/[\s().-]/g, "");
  if (E164.test(raw)) return raw;
  if (from.startsWith("+1") && /^1?[2-9]\d{9}$/.test(raw)) return raw.length === 10 ? `+1${raw}` : `+${raw}`;
  return null;
}

export const phoneId = (ctx: RouteContext, stamp: Stamp) =>
  ctx.deps.hasher.id(["outbound-phone", ctx.uid, stamp.sessionId, stamp.turnId]);

// The dial response and SIP webhook can update the same record at the same time.
// Only database work belongs inside a retryable transaction.
export async function phoneTransaction<T>(store: StorePort, uid: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await store.transaction(uid, work);
    } catch (error) {
      if (attempt >= 4 || !isStoreError(error, "staleRevision")) throw error;
    }
  }
}

export async function currentPhoneTurn(tx: Tx, uid: string, stamp: Stamp) {
  const [session, turn, core] = await Promise.all([
    tx.get<Session>(paths.session(uid, stamp.sessionId)),
    tx.get<Turn>(paths.turn(uid, stamp.sessionId, stamp.turnId)),
    readCoreDocs(tx, uid),
  ]);
  if (!session || !turn || core.epoch.data.barrier !== null) return null;
  const s = session.data;
  const t = turn.data;
  const current = currentStamp(stamp.sessionId, s.generation, {
    epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data,
  });
  if (!sameStamp(stamp, current) || (s.status !== "active" && s.status !== "minting") || t.seq !== s.lastClientSeq) return null;
  if (t.role !== "user" || t.sourceClass !== "U" || !t.final || t.parseState !== "committed" || !t.text) return null;
  return { session: s, turn: t, text: t.text };
}

/** Claim once per committed user turn. Never retry an ambiguous outbound POST. */
export async function placePhoneCall(ctx: RouteContext, stamp: Stamp): Promise<string> {
  const { uid, deps } = ctx;
  const { env, store } = deps;
  let config: ReturnType<typeof phoneConfig>;
  try {
    config = phoneConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return `Phone calling needs a valid ${error.variable} in the server environment.`;
    throw error;
  }
  const id = phoneId(ctx, stamp);
  const path = paths.ledger(uid, id);
  const claim = await phoneTransaction(store, uid, async (tx) => {
    const existing = await tx.get<PhoneEntry>(path);
    if (existing) {
      const entry = existing.data;
      if (entry.state === "pending" && msFromTs(entry.at) + 10_000 > deps.clock.read().opsClock.now) throw inFlightError();
      return { message: entry.state === "complete" ? queued : entry.state === "failed" ? rejected : unknown };
    }
    const current = await currentPhoneTurn(tx, uid, stamp);
    if (!current) return { message: "The call request is no longer current." };
    const to = destination(current.text, config.from);
    if (!to) return { message: "Please ask me to call one phone number, including its country code." };
    const now = deps.clock.read().opsClock.now;
    if (now - msFromTs(current.turn.committedAt) > SIP_WINDOW_MS) return { message: "That call request has expired." };
    const at = tsFromMs(now);
    const entry: PhoneEntry = {
      ...cFields(uid, at, stamp.epoch, stamp.policyRev), kind: "phoneCall", state: "pending", at, retainUntil: null,
      payload: { phoneCallId: id, sessionId: stamp.sessionId, turnId: stamp.turnId, twilioSid: null, realtimeCallId: null, accepted: false },
    };
    tx.create(path, entry);
    return { to };
  });
  if (claim.message !== undefined) return claim.message;
  let sid: string | null = null;
  let state: PhoneEntry["state"];
  try {
    sid = await (deps.dial ?? dialTwilio)(config, claim.to, id);
    state = "complete";
  } catch (error) {
    state = error instanceof DialRejected ? "failed" : "blocked";
  }
  await phoneTransaction(store, uid, async (tx) => {
    const row = await tx.get<PhoneEntry>(path);
    if (!row) throw new Error("Missing phone call record");
    tx.update(path, { ...row.data, state, updatedAt: tsFromMs(deps.clock.read().opsClock.now),
      payload: { ...row.data.payload, twilioSid: sid } });
  });
  return state === "complete" ? queued : state === "failed" ? rejected : unknown;
}
