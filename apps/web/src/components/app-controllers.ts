// The signed-in controllers (FSC R9.4, R29; lab-ui-foundation R11.3, R17.5, R21). Created only while
// signed in, so nothing calls an /api/ route while signed out. The DebugPanelModel exists only when the
// debug flag is on, so no GET /api/debug/memory is sent otherwise.
import type { Proactive } from "@franki/core";
import type { ApiClient } from "../client/api";
import type { BrowserClock } from "../client/clock";
import { BankWatch } from "../client/bank-watch";
import { GoogleWatch } from "../client/google-watch";
import { CallCardShelf } from "../client/call-cards";
import { CompanyTap } from "../client/company-tap";
import { ErrandShelf } from "../client/errand-shelf";
import { DebugPanelModel } from "../client/debug-panel";
import { MemoryModel } from "../client/memory-model";
import { PhoneWatch } from "../client/phone-watch";
import { randomId } from "../client/ids";
import { ProactiveShelf } from "../client/proactive-shelf";
import { confirmShown, showsOnScreen } from "../client/proactive-shown";
import { SheetModel } from "../client/sheet-model";
import { type StorageLike, VisitModel } from "../client/visit-model";
import { TypedTurns } from "../client/typed-turns";
import { type AudioLike, type PeerLike, type StreamLike, VoiceClient } from "../client/voice-client";
import type { TurnCopies } from "../ui/surface-props";
import { clearTurnCopies } from "../ui/turn-copies";
import { type StoredVisit, inputAllowed } from "../ui/visit/visit-machine";
import { COPY } from "../ui/copy";

export interface ControllerDeps {
  api: ApiClient;
  clock: BrowserClock;
  /** The transcription model, or null when not configured (no Voice_Client then). */
  transcribeModel: string | null;
  debug: boolean;
  /** Browser pieces, injected so tests can run without WebRTC. */
  audio: () => AudioLike;
  createPeer: () => PeerLike;
  getMicrophone: () => Promise<StreamLike>;
  onStreams: (s: { mic: StreamLike | null; output: unknown | null }) => void;
  /** The mic's unsmoothed level, for the Latency_Clock's last loud frame (voice-control R18.5). */
  inputLevel?: () => number;
  /** Brief 027: the signed-in user, whose visit is kept in `storage` across reloads. */
  uid?: string;
  storage?: StorageLike | null;
}

export interface SignedInControllers {
  typed: TypedTurns;
  debug: DebugPanelModel | null;
  voice: VoiceClient | null;
  /** Follows an outbound phone call for the phone on the screen. Reads only. */
  phone: PhoneWatch;
  /** The jar, the Lab, the strip, the receipt and the readout, from GET /api/memory (brief 020). Reads only. */
  memory: MemoryModel;
  /** Brief 027: the visit's clone, time bolt and start over. */
  visit: VisitModel;
  /** Brief 027: the What I know sheet, from GET /api/memory. Reads only. */
  sheet: SheetModel;
  /** Brief 027: the last proactive line the time bolt brought. */
  proactive: ProactiveShelf;
  /** Brief 044, item 1: the cards the last tool answer of a call brought. */
  callCards: CallCardShelf;
  /** Brief 049 part A: the errands' running word and cards, from the call's state polls. */
  errands: ErrandShelf;
  /** Brief 044, item 3: the company toggle's tap, and the audience the server last confirmed. */
  company: CompanyTap;
  /** Brief 046 part B: the bank sheet and its /api/bank/* calls. Sends nothing until the sheet is opened. */
  bank: BankWatch;
  /** Brief 049 part B: the Google sheet and its /api/google/* calls. Sends nothing until the sheet is opened. */
  google: GoogleWatch;
}

/**
 * Brief 038 finding 1: the input gate below the screen. While the visit has not said which account this is (no
 * clone yet, a clone being made or reset, or one that failed), no Session is opened and no typed line is sent, so
 * nothing a visitor does can write to the fresh account before its clone. The screen disables the same controls.
 */
export function gatedApi(api: ApiClient, takesInput: () => boolean, onStaleVisit: () => void = () => {}): ApiClient {
  const gated = new Set(["/api/session/open", "/api/turn"]);
  return {
    async call<T>(path: string, options?: Parameters<ApiClient["call"]>[1]) {
      const route = path.split("?")[0]!;
      if (gated.has(route) && !takesInput()) return { ok: false, kind: "http", status: 423, error: "BARRIER", retryAfterMs: 0 } as const;
      const r = await api.call<T>(path, options);
      // Brief 038 finding 4: an open that named this tab's visit was answered STALE: another tab started over.
      if (route === "/api/session/open" && !r.ok && r.kind === "http" && r.error === "STALE") onStaleVisit();
      return r;
    },
  };
}

export function createSignedInControllers(deps: ControllerDeps): SignedInControllers {
  const { clock } = deps;
  // The visit is made below; the gate reads it when a call is made, never before.
  const talk = gatedApi(
    deps.api,
    () => inputAllowed(visit.getSnapshot()),
    () => visit.reloadVisit(),
  );
  const api = deps.api;
  const callCards = new CallCardShelf();
  const errands = new ErrandShelf({ now: () => clock.mono() });
  const voice =
    deps.transcribeModel === null
      ? null
      : new VoiceClient({
          api: talk,
          clock,
          transcribeModel: deps.transcribeModel,
          audio: deps.audio(),
          createPeer: deps.createPeer,
          getMicrophone: deps.getMicrophone,
          onStreams: deps.onStreams,
          ...(deps.inputLevel === undefined ? {} : { inputLevel: deps.inputLevel }),
          // Brief 030 P1-7: a spoken false "gone" shows the same ask as a typed one.
          onControlCheck: () => memory.askGone(),
          // Brief 044, item 1: a tool answer's cards that fit the call go to the Card_Dock.
          onToolCards: (cards, stamp) => callCards.show(cards, stamp),
          // Brief 045 part S: the toggle shows the audience the call's answers confirm.
          onAudience: (stamp, audience) => company.adopt(stamp, audience),
          // Brief 049 part A: the errands' word and cards.
          onErrands: (stamp, view) => errands.onState(stamp, view),
        });
  const phone = new PhoneWatch({ api, now: () => clock.mono() });
  const memory = new MemoryModel({ api });
  const typed = new TypedTurns({
    api: talk,
    clock,
    onTurn: (turn) => phone.onTypedTurn(turn),
    onReply: (reply) => memory.onReply(reply),
    // Brief 030 P1-8: only a visit whose reset has answered is named.
    visitId: (): string | null => {
      const v: StoredVisit | null = visit.getSnapshot().visit;
      return v !== null && v.fixtureNamespace !== null ? v.visitId : null;
    },
    // Brief 030 part A: the open's line is shown, and the server is told it was.
    onAudience: (stamp, audience) => company.adopt(stamp, audience),
    onProactive: (p: Proactive): void => {
      // Brief 045 finding 7: a line that asks for an answer stays for a call.
      if (!showsOnScreen(p)) return;
      proactive.show(p, typed.getSnapshot().entries.length);
      void confirmShown(api, p, () => randomId());
    },
  });
  const sheet = new SheetModel({ api });
  // Brief 044, item 3: a tap goes on the call's Session while a call is open, else on the typed one. Through the
  // input gate, so no tap reaches a fresh account before its clone.
  const company = new CompanyTap({
    api: talk,
    newId: () => randomId(),
    worldNow: () => clock.read().worldClock.now,
    stampFor: async () => {
      const v = voice?.getSnapshot() ?? null;
      if (v === null || v.phase === "CLOSED") {
        const s = await typed.stampForTap();
        return typeof s === "string" ? s : { stamp: s, typed: true };
      }
      if (v.session === null || v.deck === null) return COPY.company.betweenCalls;
      const d = v.deck;
      return { stamp: { sessionId: v.session.sessionId, generation: v.session.generation, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev }, typed: false };
    },
    adoptTypedStamp: (s) => typed.adoptStamp(s),
  });
  const proactive = new ProactiveShelf();
  const visit = new VisitModel({
    api,
    uid: deps.uid ?? "",
    storage: deps.storage ?? null,
    newId: () => randomId(),
    call: voice === null ? null : { inCall: () => voice.getSnapshot().phase !== "CLOSED", hangUp: () => voice.hangUp(), subscribe: voice.subscribe },
    zone: () => clock.read().worldClock.zone,
    sessionId: () => voice?.getSnapshot().session?.sessionId ?? typed.getSnapshot().sessionId,
    onShow: (p) => proactive.show(p, typed.getSnapshot().entries.length),
    onAfterReset: () => {
      // A new month: nothing said or shown in the old one stays on the screen.
      typed.dropSession();
      typed.dropTurnCopies();
      proactive.clear();
      callCards.clear();
      errands.clear();
      company.clear();
      sheet.clear();
      memory.clear();
      void memory.refresh();
    },
  });
  // Brief 040, item 4: the call's opens name the visit, read as the typed line's open reads it.
  if (voice !== null) {
    const named = (): string | null => {
      const v: StoredVisit | null = visit.getSnapshot().visit;
      return v !== null && v.fixtureNamespace !== null ? v.visitId : null;
    };
    voice.setVisit(named());
    visit.subscribe(() => voice.setVisit(named()));
    // Brief 044, item 1: cards from a Session or generation the call has left go.
    voice.subscribe(() => callCards.onVoice(voice.getSnapshot()));
    voice.subscribe(() => errands.onVoice(voice.getSnapshot()));
  }
  // Brief 046 part B. A start over keeps a connected bank (ruling 9), so the visit's reset leaves this alone.
  const bank = new BankWatch({ api, now: () => clock.mono(), newId: () => randomId() });
  // Brief 049 part B. A start over keeps a connected Google account (ruling 22), as it keeps a bank.
  const google = new GoogleWatch({ api, now: () => clock.mono(), newId: () => randomId() });
  return {
    bank,
    google,
    typed,
    debug: deps.debug ? new DebugPanelModel({ api, clock }) : null,
    voice,
    phone,
    memory,
    visit,
    sheet,
    proactive,
    callCards,
    errands,
    company,
  };
}

export const EMPTY_COPIES: TurnCopies = { reply: null, caption: null, typedText: "", cards: [], jarItems: [] };

/**
 * A completed forget result (R17.5, R17.6): drop every turn copy the client holds. Wired, with no caller
 * in this slice, because no forget result reaches the browser yet (contract question 1).
 */
export function onForgetComplete(typed: TypedTurns | null, copies: TurnCopies): TurnCopies {
  typed?.dropTurnCopies();
  return clearTurnCopies(copies);
}
