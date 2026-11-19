/**
 * Keeps Franki attached to an answered phone call for its whole life, so the call always ends with a report.
 *
 * The webhook accepts the SIP call, greets, then asks `POST /api/phone/listen` to listen. App Hosting runs Cloud Run
 * with CPU only while a request is open (cpu-throttling, minInstances 0), so the listener lives inside that request,
 * whose response streams a heartbeat until the call ends. Cloud Run's request timeout is 300 s, so at 225 s the phone
 * model is told to wrap up and report, and at 250 s the call is hung up.
 *
 * The call is over when the carrier says so, when the sideband closes and can't attach again, or at the hang-up.
 * Then, if the specialist filed no report, fallback.ts files one from the transcript. Nothing of the call is stored
 * except that report. Logs carry IDs and outcomes only.
 */
import { timingSafeEqual } from "node:crypto";
import { type Turn, isIdShape } from "@franki/core";
import OpenAI from "openai";
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import { raceLimit } from "../clock/timers";
import { type Env, openaiApiKey } from "../config/env";
import { hangupCall } from "../openai/realtime-calls";
import { liveRouteDeps } from "../routes/live-deps";
import type { RouteDeps } from "../routes/runtime";
import { paths } from "../store/paths";
import { CallTranscript, hasPhoneReport, saveFallbackReport, summarizePhoneCall, summaryBudget, takeSidebandEvent } from "./fallback";
import { carrierOf, isTerminalCarrier } from "./lifecycle";
import type { PhoneEntry } from "./outbound";
import { phonePublicOrigin } from "./report-mcp";

export const PHONE_LISTEN_PATH = "/api/phone/listen";
export const PHONE_WRAP_UP_MS = 225_000;
export const PHONE_HANG_UP_MS = 250_000;
/** How long the webhook waits to see the listener's response start. The request itself is never cancelled. */
export const LISTEN_START_MS = 2_500;
const CAPABILITY_MS = 60_000;
const CARRIER_POLL_MS = 2_000;
/** After the carrier ends the call, the last words' transcripts may still be on their way. */
const TAIL_MS = 1_000;
const ATTACH_RETRY_MS = 1_000;
const MAX_ATTACHES = 4;
const HEARTBEAT_MS = 15_000;
const REPORT_WAIT_MS = 3_000;
const REPORT_POLL_MS = 500;
const LABEL = "phone-listen-capability";
export const WRAP_UP_LINE = "Time is almost up. If you haven't called report_call_outcome yet, call it now, then thank the recipient and say goodbye.";

export interface ListenBinding { uid: string; dialId: string; callId: string }

/** One sideband websocket to a call. A failed attach closes without opening. */
export interface SidebandSocket {
  onOpen(fn: () => void): void;
  onEvent(fn: (event: Record<string, unknown>) => void): void;
  onClose(fn: () => void): void;
  send(event: Record<string, unknown>): void;
  close(): void;
}
export type ConnectSideband = (callId: string) => SidebandSocket;

/** A short-lived capability for this server's own listen route. It never leaves the server. */
export function listenRequest(deps: RouteDeps, binding: ListenBinding, origin: string): { url: string; authorization: string } | null {
  const base = phonePublicOrigin(deps, origin);
  if (!base) return null;
  const body = Buffer.from(JSON.stringify({ ...binding, until: deps.clock.read().opsClock.now + CAPABILITY_MS })).toString("base64url");
  return { url: base + PHONE_LISTEN_PATH, authorization: `Bearer ${body}.${deps.hasher.id([LABEL, body])}` };
}

function listenBinding(deps: RouteDeps, header: string): ListenBinding | null {
  const match = /^Bearer ([\w-]{1,1200})\.([\w-]{43})$/.exec(header);
  if (!match) return null;
  const expected = Buffer.from(deps.hasher.id([LABEL, match[1]!]));
  const given = Buffer.from(match[2]!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const b = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")) as Partial<ListenBinding & { until: number }> | null;
    if (!b || typeof b.uid !== "string" || typeof b.callId !== "string" || typeof b.dialId !== "string" || !isIdShape(b.dialId)) return null;
    return Number.isSafeInteger(b.until) && b.until! > deps.clock.read().opsClock.now ? { uid: b.uid, dialId: b.dialId, callId: b.callId } : null;
  } catch {
    return null;
  }
}

const held = new Set<Promise<unknown>>();

/** Reads the listener's open response to its end, so neither side drops the request while the call runs. */
function holdOpen(response: Promise<Response>) {
  const done: Promise<unknown> = response.then((r) => r.body?.pipeTo(new WritableStream())).catch(() => {}).finally(() => held.delete(done));
  held.add(done);
}

/** Called by the webhook once the SIP leg is accepted. Waits briefly for the listener to answer, never for the call. */
export async function startPhoneListener(deps: RouteDeps, binding: ListenBinding, origin: string, fetcher: typeof fetch = fetch): Promise<void> {
  const target = listenRequest(deps, binding, origin);
  if (!target) {
    deps.log("phone.listenOriginUnavailable", {});
    return;
  }
  const response = fetcher(target.url, { method: "POST", headers: { authorization: target.authorization }, cache: "no-store" });
  holdOpen(response);
  if (!(await raceLimit(response, LISTEN_START_MS, deps.timers))) {
    deps.log("phone.listenStartUnconfirmed", {});
    return;
  }
  const status = await response.then((r) => r.status, () => 0);
  if (status !== 202) deps.log("phone.listenRefused", { status });
}

export type ListenOutcome = "unbound" | "reported" | "saved" | "refused";

interface Link { socket: SidebandSocket | null; closed: Promise<boolean> }

export async function listenToPhoneCall(deps: RouteDeps, binding: ListenBinding, connect: ConnectSideband): Promise<ListenOutcome> {
  const { uid, dialId, callId } = binding;
  const now = () => deps.clock.read().opsClock.now;
  const readDial = async () => {
    const row = (await deps.store.get<PhoneEntry>(uid, paths.ledger(uid, dialId)))?.data;
    return row?.kind === "phoneCall" ? row : null;
  };
  const dial = await readDial();
  if (!dial || dial.payload.realtimeCallId !== callId || !dial.payload.accepted) return "unbound";
  const assignment = (await deps.store.get<Turn>(uid, paths.turn(uid, dial.payload.sessionId, dial.payload.turnId)))?.data.text;
  if (!assignment) return "unbound";

  const started = now();
  const transcript = new CallTranscript();
  let everOpen = false;
  const attach = (): Link => {
    try {
      const socket = connect(callId);
      let open = false;
      const closed = new Promise<boolean>((resolve) => {
        socket.onOpen(() => {
          open = true;
          everOpen = true;
        });
        socket.onEvent((event) => takeSidebandEvent(transcript, event));
        socket.onClose(() => resolve(open));
      });
      return { socket, closed };
    } catch {
      return { socket: null, closed: Promise.resolve(false) };
    }
  };

  let link: Link | null = attach();
  let attaches = 1;
  let wrapped = false;
  let polledAt = started;
  let latest: PhoneEntry | null = dial;
  for (;;) {
    const elapsed = now() - started;
    if (elapsed >= PHONE_HANG_UP_MS) {
      await hangupCall(deps.openai, callId).catch(() => deps.log("phone.listenHangupFailed", {}));
      if (link) await raceLimit(link.closed, TAIL_MS, deps.timers);
      break;
    }
    if (link?.socket && everOpen && !wrapped && elapsed >= PHONE_WRAP_UP_MS) {
      wrapped = true;
      link.socket.send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: WRAP_UP_LINE }] } });
      link.socket.send({ type: "response.create" });
    }
    const wait = Math.min(CARRIER_POLL_MS, (elapsed < PHONE_WRAP_UP_MS ? PHONE_WRAP_UP_MS : PHONE_HANG_UP_MS) - elapsed);
    if (link) {
      if (await raceLimit(link.closed, wait, deps.timers)) {
        const wasOpen = await link.closed;
        link = null;
        // A socket that never opened after an earlier one did: the call is gone.
        if (everOpen && !wasOpen) break;
        if (attaches < MAX_ATTACHES) {
          if (!wasOpen) await deps.timers.sleep(ATTACH_RETRY_MS);
          attaches++;
          link = attach();
        } else if (everOpen) {
          break;
        }
        // Never attached: the carrier decides when the call is over.
      }
    } else {
      await deps.timers.sleep(wait);
    }
    if (now() - polledAt >= CARRIER_POLL_MS) {
      polledAt = now();
      latest = await readDial().catch(() => latest);
      const carrier = latest ? carrierOf(latest) : null;
      if (carrier && isTerminalCarrier(carrier.status)) {
        if (link) await raceLimit(link.closed, TAIL_MS, deps.timers);
        break;
      }
    }
  }
  link?.socket?.close();

  const reported = () => hasPhoneReport(deps, uid, dialId).catch(() => false);
  if (await reported()) return "reported";
  // The specialist's own report may still be in flight when the call ends. It takes precedence over a summary.
  for (let waited = 0; transcript.reportStarted && waited < REPORT_WAIT_MS; waited += REPORT_POLL_MS) {
    await deps.timers.sleep(REPORT_POLL_MS);
    if (await reported()) return "reported";
  }
  const ended = await readDial().catch(() => latest);
  const report = await summarizePhoneCall(deps, assignment, transcript.lines(), summaryBudget(ended, now()));
  return (await saveFallbackReport(deps, uid, dialId, callId, report)) ? "saved" : "refused";
}

export function liveSideband(env: Env): ConnectSideband {
  const client = new OpenAI({ apiKey: openaiApiKey(env), maxRetries: 0, timeout: 6000 });
  return (callID) => {
    const ws = new OpenAIRealtimeWS({ callID }, client);
    // A failed attach shows as a close before open. Never log provider bodies.
    ws.on("error", () => {});
    return {
      onOpen: (fn) => void ws.socket.once("open", fn),
      onEvent: (fn) => void ws.on("event", (event) => fn(event as unknown as Record<string, unknown>)),
      onClose: (fn) => void ws.socket.once("close", () => fn()),
      send: (event) => ws.send(event as never),
      close: () => ws.close(),
    };
  };
}

const listening = new Set<string>();
const encoder = new TextEncoder();

/** The webhook's own request to stay on the call. Only a capability minted by this server opens it. */
export async function phoneListenEndpoint(request: Request, deps: RouteDeps = liveRouteDeps(), connect?: ConnectSideband): Promise<Response> {
  if (request.headers.has("origin")) return new Response(null, { status: 403 });
  const binding = listenBinding(deps, request.headers.get("authorization") ?? "");
  if (!binding) return new Response(null, { status: 401 });
  if (listening.has(binding.callId)) return new Response(null, { status: 409 });
  listening.add(binding.callId);
  const job = (async () => {
    try {
      deps.log("phone.listenEnded", { outcome: await listenToPhoneCall(deps, binding, connect ?? liveSideband(deps.env)) });
    } catch {
      deps.log("phone.listenFailed", {});
    } finally {
      listening.delete(binding.callId);
    }
  })();
  // The open body keeps this request, and so this instance's CPU, alive until the call has its report.
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("listening\n"));
      void (async () => {
        while (!(await raceLimit(job, HEARTBEAT_MS, deps.timers))) {
          try {
            controller.enqueue(encoder.encode("\n"));
          } catch {
            return;
          }
        }
        try {
          controller.close();
        } catch {
          // The client already went away; the listener has finished either way.
        }
      })();
    },
  });
  return new Response(body, { status: 202, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
