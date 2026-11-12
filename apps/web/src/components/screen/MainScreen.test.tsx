import { type VoiceState, avatarState, initialVoiceState } from "@franki/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { STAGE_WIDTH, Stage } from "../avatar/Stage";
import { CANVAS_FRAME } from "../avatar/canvas-frame";
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

const GLOBALS = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

describe("the lab's shell (brief 015)", () => {
  it("the stage is clamp(240px, 34vh, 340px) wide, never wider than its column, and the floor scales with it", () => {
    const html = render(true);
    expect(html).toMatch(/data-stage=""[^>]*class="[^"]*w-\[clamp\(240px,34vh,340px\)\][^"]*max-w-\[min\(100%,/);
    expect(html).not.toContain("max-w-[240px]");
    expect(html).toMatch(/data-part="floor"[^>]*class="[^"]*aspect-\[12\/1\][^"]*w-3\/5/);
    expect(html).toMatch(/data-part="halo"[^>]*class="[^"]*inset-\[-20%\]/);
  });

  it("the header is a rail: wordmark and bolt, the time-badge slot, sound, email in mono 12, Sign out, over a fading seam", () => {
    const html = render(true);
    const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    const order = ["data-wordmark-bolt", ">Franki<", 'data-slot="time-badge"', "data-sound-toggle", 'data-testid="signed-in-email"', ">Sign out<", "data-rail-seam"].map((m) => header.indexOf(m));
    expect(order.every((i) => i >= 0), String(order)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(header).toMatch(/data-testid="signed-in-email" class="[^"]*font-mono text-xs/);
    expect(header).toMatch(/data-rail-seam=""[^>]*class="[^"]*mask-image:linear-gradient\(to_right,transparent,/);
    expect(header).toMatch(/data-rail-seam[^>]*>[\s\S]*data-seam=""/);
    expect(header).toMatch(/aria-hidden="true" data-rail-seam/);
  });

  it("the stage never grows past the width at which the canvas fits the viewport", () => {
    const html = render(true);
    expect(html).toMatch(/data-stage=""[^>]*class="[^"]*max-w-\[min\(100%,calc\(100vw\/1\.48\)\)\]/);
    // The canvas spills CANVAS_FRAME.left of the box and is CANVAS_FRAME.width wide; centred, its wider half is
    // 0.5 - left stage widths from the axis. At 100vw / 1.48 that half fits in half the viewport.
    const half = Math.max(0.5 - CANVAS_FRAME.left, CANVAS_FRAME.left + CANVAS_FRAME.width - 0.5);
    expect(half / 1.48).toBeLessThanOrEqual(0.5 + 1e-9);
    // At 375 px the cap is about 253 px, still above the 240 px floor of the clamp.
    expect(375 / 1.48).toBeGreaterThan(240);
  });

  // The sweep runs over the stage's own clamp range, read from Stage.tsx.
  const clamp = /clamp\((\d+)px,[^,]+,(\d+)px\)/.exec(STAGE_WIDTH);
  const STAGE_RANGE = { min: Number(clamp?.[1]), max: Number(clamp?.[2]) };
  it("the stage's clamp range reads as 240 to 340 px", () => {
    expect(STAGE_RANGE).toEqual({ min: 240, max: 340 });
  });

  // A stage W wide has a canvas CANVAS_FRAME.height * W tall, starting -CANVAS_FRAME.top * W above the box.
  const SCREENS = [
    // Signed out, the Wordmark's box ends 24 px (gap-6) above the avatar box.
    { screen: "signed-out", px: 24, layout: /data-area="stage"[^>]*class="[^"]*\bgap-6\b/ },
    // Signed in, the stage section's top padding (py-4) is the 16 px above the box; the rail and strip are above it.
    { screen: "signed-in", px: 16, layout: /data-area="stage"[^>]*class="[^"]*\bpy-4\b/ },
  ] as const;

  for (const { screen, px: edge, layout } of SCREENS) {
    it(`${screen}: the canvas mask keeps everything above the stage clear and Franki's hair whole at every stage width`, () => {
      expect(render(screen === "signed-in")).toMatch(layout);
      const rule = new RegExp(`\\[data-screen="${screen}"\\] \\[data-three-layer="canvas"\\] \\{([^}]*)\\}`).exec(GLOBALS)?.[1] ?? "";
      expect(rule).toContain("radial-gradient(closest-side, black 72%, transparent)");
      expect(rule).toMatch(/mask-composite: intersect/);
      const m = /linear-gradient\(to bottom, transparent calc\(([\d.]+)% - (\d+)px\), black ([\d.]+)%\)/.exec(rule);
      expect(m, rule).not.toBeNull();
      const [pct, px, opaque] = [Number(m![1]), Number(m![2]), Number(m![3])];
      expect(px).toBe(edge);
      // The rule's percentage is the canvas frame's top spill over its height, so a recalibrated frame turns this red.
      expect(pct / 100).toBeCloseTo(-CANVAS_FRAME.top / CANVAS_FRAME.height, 3);
      // The hair starts at about 19% of the canvas.
      const HAIR = 0.19;
      for (let w = STAGE_RANGE.min; w <= STAGE_RANGE.max; w += 4) {
        const canvas = CANVAS_FRAME.height * w;
        const clearPx = (pct / 100) * canvas - px;
        const aboveEdge = -CANVAS_FRAME.top * w - edge;
        expect(Math.abs(clearPx - aboveEdge), `w=${w}`).toBeLessThan(0.05);
        expect(clearPx / canvas, `w=${w}`).toBeLessThan(opaque / 100);
        expect(opaque / 100, `w=${w}`).toBeLessThan(HAIR);
      }
    });
  }
});
