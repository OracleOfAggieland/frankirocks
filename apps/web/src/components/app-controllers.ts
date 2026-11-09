// The signed-in controllers (FSC R9.4, R29; lab-ui-foundation R11.3, R17.5, R21). Created only while
// signed in, so nothing calls an /api/ route while signed out. The DebugPanelModel exists only when the
// debug flag is on, so no GET /api/debug/memory is sent otherwise.
import type { ApiClient } from "../client/api";
import type { BrowserClock } from "../client/clock";
import { DebugPanelModel } from "../client/debug-panel";
import { TypedTurns } from "../client/typed-turns";
import { type AudioLike, type PeerLike, type StreamLike, VoiceClient } from "../client/voice-client";
import type { TurnCopies } from "../ui/surface-props";
import { clearTurnCopies } from "../ui/turn-copies";

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
}

export interface SignedInControllers {
  typed: TypedTurns;
  debug: DebugPanelModel | null;
  voice: VoiceClient | null;
}

export function createSignedInControllers(deps: ControllerDeps): SignedInControllers {
  const { api, clock } = deps;
  const voice =
    deps.transcribeModel === null
      ? null
      : new VoiceClient({
          api,
          clock,
          transcribeModel: deps.transcribeModel,
          audio: deps.audio(),
          createPeer: deps.createPeer,
          getMicrophone: deps.getMicrophone,
          onStreams: deps.onStreams,
        });
  return { typed: new TypedTurns({ api, clock }), debug: deps.debug ? new DebugPanelModel({ api, clock }) : null, voice };
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
