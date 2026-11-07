import { type VoiceState, avatarState, initialVoiceState } from "@franki/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { lookFor } from "../../ui/avatar/look";
import type { AvatarInput } from "../../ui/avatar/types";
import { AuthPanel } from "../AuthPanel";
import { CallScreen } from "../CallScreen";
import { LiveRegion } from "../LiveRegion";
import { ReplyLine } from "../ReplyLine";
import { SoundPreference, SoundToggle } from "../SoundToggle";
import { TypedLine } from "../TypedLine";
import { Avatar } from "../avatar/Avatar";
import { Stage } from "../avatar/Stage";
import { GRID_AREAS, MainScreen } from "./MainScreen";

const noop = () => {};
const storage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

function render(signedIn: boolean, voice: VoiceState = initialVoiceState({ transcribeModel: "m" })) {
  const input: AvatarInput = {
    state: signedIn ? avatarState(voice) : "closed", micMuted: voice.micMuted, outputMuted: voice.outputMuted,
    inputLevel: 0, outputLevel: 0, event: null, eventElapsedMs: 0, firstConnecting: false, reducedMotion: true,
  };
  return renderToStaticMarkup(
    <MainScreen
      signedIn={signedIn}
      reduced
      paused={false}
      auth={
        <AuthPanel
          state={signedIn ? { kind: "signedIn", email: "owner@example.com", uid: "u1" } : { kind: "signedOut", error: null }}
          busy={false}
          configMissing={null}
          onSignIn={noop}
          onSignOut={noop}
        />
      }
      soundToggle={<SoundToggle preference={new SoundPreference(storage())} />}
      stage={
        <Stage reduced>
          <Avatar look={lookFor(input)} input={input} />
        </Stage>
      }
      controls={<CallScreen voice={voice} enabled={signedIn} onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />}
      typed={<TypedLine text="" enabled={signedIn} sending={false} canSend={false} error={null} onChange={noop} onSubmit={noop} />}
      reply={signedIn ? <ReplyLine entries={[{ role: "user", text: "hi" }, { role: "franki", text: "Hello." }]} /> : null}
      live={<LiveRegion message={null} seq={0} />}
    />,
  );
}

const SURFACE_MARKERS = ["data-card=", "data-dock=", "data-strip=", "data-jar=", "data-sheet=", "data-lab=", "data-receipt=", "data-time-badge=", "data-chips=", "data-captions="];

describe("MainScreen", () => {
  it("lays out every named grid area, signed in and out", () => {
    for (const html of [render(true), render(false)]) {
      for (const area of GRID_AREAS) expect(html).toContain(`data-area="${area}"`);
      expect(html).toContain("grid-template-areas");
      expect(html).toContain('data-backdrop=""');
    }
  });

  it("signed out: Dormant avatar, FRANKIROCKS, the sign-in button, a disabled call button and typed glyph", () => {
    const html = render(false);
    expect(html).toContain('data-look="Dormant"');
    expect(html).toContain('data-wordmark="signedOut"');
    expect(html).toContain(">Sign in to wake Franki<");
    expect(html).toMatch(/data-form="start"[^>]*disabled=""/);
    expect(html).toMatch(/data-typed-line="collapsed"[^>]*disabled=""/);
    expect(html).not.toContain("signed-in-email");
  });

  it("renders no Card, Strip, Jar, sheet, Lab, Receipt, Time_Badge, Chips or Captions", () => {
    for (const html of [render(true), render(false)]) {
      for (const marker of SURFACE_MARKERS) expect(html, marker).not.toContain(marker);
    }
  });

  it("signed in: header wordmark, email and sign-out", () => {
    const html = render(true);
    expect(html).toContain('data-wordmark="header"');
    expect(html).toContain('data-testid="signed-in-email"');
    expect(html).toContain("owner@example.com");
    expect(html).toContain(">Sign out<");
    expect(html.indexOf('data-area="header"')).toBeLessThan(html.indexOf("owner@example.com"));
    expect(html.indexOf("owner@example.com")).toBeLessThan(html.indexOf('data-area="stage"'));
  });

  it("controls are in DOM order, with no positive tabindex, a focus ring and a 44 px target", () => {
    const html = render(true, { ...initialVoiceState({ transcribeModel: "m" }), phase: "LISTENING" });
    expect(html).not.toMatch(/tabindex="[1-9]/i);
    const controls = [...html.matchAll(/<(button|textarea|summary)\b[^>]*>/g)].map((m) => m[0]);
    expect(controls.length).toBeGreaterThanOrEqual(5);
    for (const c of controls) {
      expect(c, c).toMatch(/focus-visible:outline/);
      expect(c, c).toMatch(/min-h-11|h-16/);
    }
    const order = ["data-sound-toggle", ">Sign out<", 'data-form="hangup"', "Mute microphone", 'data-typed-line="collapsed"'].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
