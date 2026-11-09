import { type VoiceState, avatarState, initialVoiceState } from "@franki/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { lookFor } from "../../ui/avatar/look";
import type { AvatarInput } from "../../ui/avatar/types";
import type { CardProps } from "../../ui/surface-props";
import { AuthPanel } from "../AuthPanel";
import { CallScreen } from "../CallScreen";
import { LiveRegion } from "../LiveRegion";
import { ReplyLine } from "../ReplyLine";
import { SoundPreference, SoundToggle } from "../SoundToggle";
import { TypedLine } from "../TypedLine";
import { Avatar } from "../avatar/Avatar";
import { Stage } from "../avatar/Stage";
import { GRID_AREAS, HEADER, MainScreen } from "./MainScreen";

const noop = () => {};
const storage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

function render(signedIn: boolean, voice: VoiceState = initialVoiceState({ transcribeModel: "m" }), cards?: CardProps[], reduced = true) {
  const input: AvatarInput = {
    state: signedIn ? avatarState(voice) : "closed", micMuted: voice.micMuted, outputMuted: voice.outputMuted,
    inputLevel: 0, outputLevel: 0, event: null, eventElapsedMs: 0, firstConnecting: false, reducedMotion: true,
  };
  return renderToStaticMarkup(
    <MainScreen
      signedIn={signedIn}
      reduced={reduced}
      cards={cards}
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

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The open tags enclosing the first element whose start tag contains `marker`, outermost first. */
function ancestorsOf(html: string, marker: string): string[] {
  const stack: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
    const [tag, closing, name, selfClosing] = m;
    if (tag.includes(marker)) return stack;
    if (closing) stack.pop();
    else if (!selfClosing && !VOID.has(name.toLowerCase())) stack.push(tag);
  }
  throw new Error(`no element with ${marker}`);
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
    expect(html).not.toContain('data-testid="signed-in-email"');
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

  it("with no Card the grid has one column at every width, so the stage is centred", () => {
    for (const html of [render(true), render(false)]) {
      expect(html).toContain('data-layout="center"');
      expect(html).not.toContain("lg:grid-cols-[1fr_minmax(0,22rem)]");
      expect(html).not.toContain("stage_dock");
    }
  });

  it("with a Card the dock column appears from 1024 px and the dock holds the Card", () => {
    const card: CardProps = { kind: "read", id: "r", title: "Your list", sources: [], onOpenSource: noop, lines: ["Milk"] };
    const html = render(true, undefined, [card]);
    expect(html).toContain('data-layout="dock"');
    expect(html).toContain("lg:grid-cols-[1fr_minmax(0,22rem)]");
    expect(html).toContain("stage_dock");
    expect(html).toContain("data-dock=");
    expect(html.indexOf('data-area="dock"')).toBeLessThan(html.indexOf('data-card="read"'));
    // An empty Card is not a Card: the layout stays centred.
    expect(render(true, undefined, [{ ...card, lines: [] }])).toContain('data-layout="center"');
  });

  it("the stage, controls and reply each sit in a glide wrapper in both motion settings", () => {
    for (const reduced of [true, false]) {
      const html = render(true, undefined, undefined, reduced);
      expect(ancestorsOf(html, 'data-stage=""').some((t) => t.includes('data-glide="stage"'))).toBe(true);
      expect(ancestorsOf(html, 'data-form="start"').some((t) => t.includes('data-glide="controls"'))).toBe(true);
      expect(ancestorsOf(html, "data-reply-line").some((t) => t.includes('data-glide="reply"'))).toBe(true);
      // A position-only layout animation moves a box only when its edge moves: a full-width wrapper keeps
      // its left edge when the column narrows, so its centred content would jump. Each wrapper is capped.
      for (const name of ["stage", "controls", "reply"]) {
        expect(html, name).toMatch(new RegExp(`data-glide="${name}"[^>]*class="[^"]*\\bmax-w-(sm|xl)\\b`));
      }
    }
  });

  it("with a Card the controls, chips and reply stay in the stage column, on Franki's axis", () => {
    const card: CardProps = { kind: "read", id: "r", title: "Your list", sources: [], onOpenSource: noop, lines: ["Milk"] };
    const html = render(true, undefined, [card]);
    const areas = /lg:\[grid-template-areas:([^\]]*)\]/.exec(html.replaceAll("&#x27;", "'"))?.[1] ?? "";
    expect(areas).toContain("'stage_dock'");
    for (const row of ["chips", "controls", "reply"]) expect(areas, row).toContain(`'${row}_.'`);
    // Below 1024 px the bottom sheet covers the foot of the screen; the grid keeps room to scroll past it.
    expect(html).toMatch(/max-lg:pb-\[/);
  });

  it("signed out: the FRANKIROCKS Wordmark is outside the stage glide wrapper and never wraps", () => {
    // Regression: inside the glide wrapper's max-w-sm (384 px) the word broke onto two lines at 1440 px.
    for (const docked of [false, true]) {
      const card: CardProps = { kind: "read", id: "r", title: "Your list", sources: [], onOpenSource: noop, lines: ["Milk"] };
      const html = render(false, undefined, docked ? [card] : undefined, false);
      const enclosing = ancestorsOf(html, 'data-wordmark="signedOut"');
      expect(enclosing.some((t) => t.includes("data-glide"))).toBe(false);
      // No enclosing element caps the width below the page's own max-w-6xl.
      for (const t of enclosing) expect(t, t).not.toMatch(/\bmax-w-(?!6xl\b)/);
      expect(html).toMatch(/data-wordmark="signedOut"[^>]*whitespace-nowrap/);
      // The Wordmark still comes before Franki.
      expect(html.indexOf('data-wordmark="signedOut"')).toBeLessThan(html.indexOf('data-stage=""'));
    }
  });

  it("the header keeps one row at 375 px: no wrap, and the email is hidden below 640 px but stays readable", () => {
    expect(HEADER).toContain("flex-nowrap");
    expect(HEADER).not.toMatch(/(^|\s)flex-wrap\b/);
    expect(HEADER).toContain("max-sm:[&_[data-testid=signed-in-email]]:sr-only");
    const html = render(true);
    expect(html).toContain(`class="${HEADER.replaceAll("&", "&amp;")}"`);
    expect(html).toContain("owner@example.com");
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
