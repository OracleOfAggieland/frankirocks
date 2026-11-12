// The signed-in controllers (FSC R9.4, R29; lab-ui-foundation R11.3, R17.5, R21). Created only while
// signed in, so nothing calls an /api/ route while signed out. The DebugPanelModel exists only when the
// debug flag is on, so no GET /api/debug/memory is sent otherwise.
import type { ApiClient } from "../client/api";
import type { BrowserClock } from "../client/clock";
import { DebugPanelModel } from "../client/debug-panel";
import { MemoryModel } from "../client/memory-model";
import { PhoneWatch } from "../client/phone-watch";
import { randomId } from "../client/ids";
import { ProactiveShelf } from "../client/proactive-shelf";
import { SheetModel } from "../client/sheet-model";
import { type StorageLike, VisitModel } from "../client/visit-model";
import { TypedTurns } from "../client/typed-turns";
import { type AudioLike, type PeerLike, type StreamLike, VoiceClient } from "../client/voice-client";
import type { TurnCopies } from "../ui/surface-props";
import { clearTurnCopies } from "../ui/turn-copies";
import { type StoredVisit, inputAllowed } from "../ui/visit/visit-machine";

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
}

/**
 * Brief 038 finding 1: the input gate below the screen. While the visit has not said which account this is (no
 * clone yet, a clone being made or reset, or one that failed), no Session is opened and no typed line is sent, so
 * nothing a visitor does can write to the fresh account before its clone. The screen disables the same controls.
 */
export function gatedApi(api: ApiClient, takesInput: () => boolean): ApiClient {
  const gated = new Set(["/api/session/open", "/api/turn"]);
  return {
    call<T>(path: string, options?: Parameters<ApiClient["call"]>[1]) {
      if (gated.has(path.split("?")[0]!) && !takesInput()) return Promise.resolve({ ok: false, kind: "http", status: 423, error: "BARRIER", retryAfterMs: 0 } as const);
      return api.call<T>(path, options);
    },
  };
}

export function createSignedInControllers(deps: ControllerDeps): SignedInControllers {
  const { clock } = deps;
  // The visit is made below; the gate reads it when a call is made, never before.
  const talk = gatedApi(deps.api, () => inputAllowed(visit.getSnapshot()));
  const api = deps.api;
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
  });
  const sheet = new SheetModel({ api });
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
      sheet.clear();
      memory.clear();
      void memory.refresh();
    },
  });
  return {
    typed,
    debug: deps.debug ? new DebugPanelModel({ api, clock }) : null,
    voice,
    phone,
    memory,
    visit,
    sheet,
    proactive,
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
