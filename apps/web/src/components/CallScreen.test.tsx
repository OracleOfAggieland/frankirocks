// Call controls (FSC R16.4 to R16.6, R13.8, R15.8; lab-ui-foundation R14.4 to R14.6). Moved from
// StandInAvatar.test.tsx; the class assertions follow the token classes of R14.4.
import { type VoiceState, initialVoiceState } from "@franki/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CALL_ERRORS, CallScreen, pressSparks } from "./CallScreen";

const noop = () => {};
const base = initialVoiceState({ transcribeModel: "m" });
const voice = (patch: Partial<VoiceState>): VoiceState => ({ ...base, ...patch });
const screen = (v: VoiceState, enabled = true) =>
  renderToStaticMarkup(<CallScreen voice={v} enabled={enabled} onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />);
const callButtonHtml = (html: string) => /<button[^>]*data-form="[^"]+"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
const cls = (html: string) => /data-form="[^"]+"[^>]*class="([^"]+)"/.exec(html)?.[1] ?? "";

describe("call controls (R16.4–R16.6)", () => {
  it("one call button: start form while closed, hang-up form otherwise, differing in shape and colour", () => {
    const closed = screen(base);
    const live = screen(voice({ phase: "LISTENING" }));
    expect(closed.match(/data-form=/g)).toHaveLength(1);
    expect(live.match(/data-form=/g)).toHaveLength(1);
    expect(closed).toContain('data-form="start"');
    expect(live).toContain('data-form="hangup"');
    expect(closed).toContain('data-shape="round"');
    expect(live).toContain('data-shape="square"');
    expect(cls(closed)).toContain("rounded-full");
    expect(cls(closed)).toContain("ring-brass");
    expect(callButtonHtml(closed)).toContain("bg-ecto");
    expect(cls(live)).toContain("bg-ember");
    expect(cls(live)).not.toContain("rounded-full");
    expect(callButtonHtml(live)).not.toContain("bg-ecto");
  });

  it("labels the forms Call Franki and Hang up, with a 64 px target", () => {
    expect(screen(base)).toContain('aria-label="Call Franki"');
    expect(screen(voice({ phase: "LISTENING" }))).toContain('aria-label="Hang up"');
    expect(cls(screen(base))).toContain("h-16 w-16");
  });

  it("mute toggle only while listening, thinking or speaking, and shows when the mic is muted", () => {
    const shown = (v: VoiceState) => screen(v).includes("microphone");
    expect(shown(base)).toBe(false);
    expect(shown(voice({ phase: "CONNECTING" }))).toBe(false);
    expect(shown(voice({ phase: "RECOVERY", recovery: { kind: "line", since: 0, attempts: 0 } }))).toBe(false);
    for (const phase of ["LISTENING", "HELD", "SPEAKING", "TOOL_WAIT", "WAIT_ITEM"] as const) expect(shown(voice({ phase })), phase).toBe(true);
    const muted = screen(voice({ phase: "LISTENING", micMuted: true }));
    expect(muted).toContain('aria-pressed="true"');
    expect(muted).toContain('aria-label="Unmute microphone"');
    expect(muted).toContain('data-testid="muted-indicator"');
    expect(muted).toContain("Your microphone is muted.");
    expect(screen(voice({ phase: "LISTENING" }))).toContain('aria-label="Mute microphone"');
  });

  it("disabled while signed out, while a hang-up is in progress, and while an open is pending", () => {
    expect(screen(base, false)).toMatch(/data-form="start"[^>]*disabled=""/);
    expect(screen(voice({ hangingUp: true }))).toMatch(/data-form="start"[^>]*disabled=""/);
    expect(screen(base)).not.toMatch(/data-form="start"[^>]*disabled=""/);
  });

  it("names the failed step inline and offers retry after 30 s of recovery", () => {
    const escaped = (s: string) => s.replaceAll("'", "&#x27;");
    expect(screen(voice({ error: "open" }))).toContain(escaped(CALL_ERRORS.open));
    expect(screen(voice({ error: "close" }))).toContain(escaped(CALL_ERRORS.close));
    expect(screen(voice({ error: "open" }))).toContain('data-step="open"');
    const recovering = voice({ phase: "RECOVERY", recovery: { kind: "connection", since: 0, attempts: 3 } });
    expect(screen(recovering)).not.toContain(">Try again<");
    expect(screen({ ...recovering, retryVisible: true })).toContain(">Try again<");
  });

  it("error and set-up copy is plain and short: no internals, no cause words", () => {
    expect(CALL_ERRORS.open).toBe("Franki couldn't connect. Press call to try again.");
    expect(CALL_ERRORS.close).toBe("You've hung up. The line will close on its own.");
    for (const text of Object.values(CALL_ERRORS)) {
      expect(text).not.toMatch(/session|server|seconds|expires|failed|because|caused|thanks to|led to|won back/i);
      expect(text.length).toBeLessThanOrEqual(60);
    }
    const html = renderToStaticMarkup(
      <CallScreen voice={base} enabled configMissing="TRANSCRIBE_MODEL" onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />,
    );
    expect(html).toContain("Calls aren&#x27;t set up here yet.");
    expect(html).not.toContain("Missing:");
    expect(html).toMatch(/data-form="start"[^>]*disabled=""/);
  });

  it("every control has a visible focus style", () => {
    const html = screen(voice({ phase: "LISTENING" }));
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html.match(/focus-visible:outline-2/g)?.length).toBe(2);
  });
});

const SCREEN_CSS = readFileSync(join(__dirname, "screen/screen.css"), "utf8");
/** The start tag of the first element that carries `marker`. */
const startTag = (html: string, marker: string) => new RegExp(`<[a-z]+[^>]*${marker}[^>]*>`).exec(html)?.[0] ?? "";

describe("the call button's bezel and status lines (brief 015)", () => {
  it("a knurled bezel surrounds the button: round for the start form, squared for hang-up, outside the button", () => {
    const closed = screen(base);
    const live = screen(voice({ phase: "LISTENING" }));
    expect(closed).toContain('data-call-bezel="round"');
    expect(live).toContain('data-call-bezel="square"');
    for (const html of [closed, live]) {
      // The bezel comes before the button, so the button and its focus ring paint over the metal.
      expect(html.indexOf("data-bezel-ring")).toBeLessThan(html.indexOf("data-form="));
      expect(callButtonHtml(html)).not.toContain("data-bezel");
      expect(startTag(html, "data-bezel-ring")).toContain('aria-hidden="true"');
      expect(startTag(html, "data-bezel-ring")).toContain("pointer-events-none");
    }
    // The 64 px core keeps its classes.
    expect(cls(closed)).toContain("h-16 w-16");
    expect(cls(live)).toContain("h-16 w-16");
  });

  it("the knurl's ticks divide the band evenly: 72 round, 80 square", () => {
    const period = (html: string) => {
      const [dash, gap] = (/data-bezel-knurl[^>]*>\s*<[a-z]+[^>]*stroke-dasharray="([^"]+)"/.exec(html)?.[1] ?? "").split(" ").map(Number);
      return dash + gap;
    };
    const round = 2 * Math.PI * 40.5;
    const square = 4 * (81 - 41) + 2 * Math.PI * 20.5;
    expect(period(screen(base)) * 72).toBeCloseTo(round, 2);
    expect(period(screen(voice({ phase: "LISTENING" }))) * 80).toBeCloseTo(square, 2);
  });

  it("disabled, the bezel is dim and the start core dark; enabled, the core is lit ecto", () => {
    const off = screen(base, false);
    expect(off).toContain('data-bezel-state="dim"');
    expect(off).toContain('data-core="dark"');
    expect(callButtonHtml(off)).not.toContain("bg-ecto");
    const on = screen(base);
    expect(on).toContain('data-bezel-state="lit"');
    expect(on).toContain('data-core="lit"');
  });

  it("only the round knurl turns, slowly, on hover or focus, and only with motion allowed", () => {
    expect(screen(base)).toMatch(/data-bezel-knurl="" class="franki-anim"/);
    expect(screen(voice({ phase: "LISTENING" }))).not.toMatch(/data-bezel-knurl="" class="franki-anim"/);
    const motionBlock = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/.exec(SCREEN_CSS)?.[1] ?? "";
    expect(motionBlock).toMatch(/\[data-call-bezel="round"\] \[data-bezel-knurl\] \{[^}]*animation: franki-bezel-turn[^}]*animation-play-state: paused/);
    expect(motionBlock).toMatch(/:has\(> button:enabled:focus-visible\) \[data-bezel-knurl\] \{\s*animation-play-state: running/);
    expect(motionBlock).not.toContain(":hover");
    // Hover runs it only where a pointer can hover, so a tap on a touch screen never leaves it turning.
    const hoverBlock = /@media \(prefers-reduced-motion: no-preference\) and \(hover: hover\) \{([\s\S]*?)\n\}/.exec(SCREEN_CSS)?.[1] ?? "";
    expect(hoverBlock).toMatch(/\[data-call-bezel="round"\]:has\(> button:enabled:hover\) \[data-bezel-knurl\] \{\s*animation-play-state: running/);
    expect(SCREEN_CSS.replace(hoverBlock, "")).not.toContain(":hover");
    // Outside the media query nothing runs the turn.
    expect(SCREEN_CSS.replace(motionBlock, "")).not.toMatch(/animation:\s*franki-bezel-turn/);
  });

  it("the button's hit area covers the whole 88 px bezel, round for start and squared for hang-up", () => {
    const closed = cls(screen(base));
    const live = cls(screen(voice({ phase: "LISTENING" })));
    for (const c of [closed, live]) expect(c.replaceAll("&#x27;", "'")).toContain("before:absolute before:-inset-3 before:content-['']");
    expect(closed).toContain("before:rounded-full");
    expect(live).toContain("before:rounded-[24px]");
    // The 64 px core keeps its classes.
    expect(closed).toContain("h-16 w-16");
  });

  it("a press sends the ring spark only from an enabled start form", () => {
    expect(pressSparks(true, false)).toBe(true);
    expect(pressSparks(true, true)).toBe(false);
    expect(pressSparks(false, false)).toBe(false);
    expect(pressSparks(false, true)).toBe(false);
  });

  it("the status lines under the button are mono 12", () => {
    const tag = (html: string, marker: string) => startTag(html, marker);
    expect(tag(screen(voice({ phase: "LISTENING", micMuted: true })), 'data-testid="muted-indicator"')).toMatch(/font-mono text-xs/);
    expect(tag(screen(voice({ error: "open" })), 'data-step="open"')).toMatch(/font-mono text-xs/);
    const missing = renderToStaticMarkup(<CallScreen voice={base} enabled configMissing="X" onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />);
    expect(tag(missing, "data-config-missing")).toMatch(/font-mono text-xs/);
  });

  it("mute is a brass toggle with a microphone glyph, struck through while muted, beside the button", () => {
    const open = screen(voice({ phase: "LISTENING" }));
    const muted = screen(voice({ phase: "LISTENING", micMuted: true }));
    expect(open).toContain('data-mic="open"');
    expect(open).not.toContain("data-strike");
    expect(muted).toContain('data-mic="struck"');
    expect(muted).toContain("data-strike");
    expect(muted).toMatch(/aria-pressed="true"[^>]*class="[^"]*\bmat-brass\b/);
    // The call button holds the middle column whether or not the mute toggle is there.
    expect(startTag(open, "data-call-bezel")).toContain("col-start-2");
    expect(open).toMatch(/aria-label="Mute microphone"[^>]*class="[^"]*\bcol-start-3\b/);
  });
});

const POWER_CSS = readFileSync(join(__dirname, "screen/power.css"), "utf8");

describe("the power button (Nov 13)", () => {
  it("the lit start form sits on a dial with four rivets and a glowing pilot lamp, in an ecto aura", () => {
    const on = screen(base);
    expect(on).toContain('data-power-dial="on"');
    expect(on).toContain('data-power-aura="ecto"');
    expect(on).toContain("data-power-pilot");
    expect(on).toContain("data-power-chase");
    expect(on).toContain("data-power-plasma");
    expect(on).toContain('data-power-glyph="lit"');
    // Four rivets: each is a shadow and a brass dome.
    expect(on.match(/r="1.9"/g)).toHaveLength(4);
    // The dial and the aura are outside the button, so the hit area and focus ring stay as they were.
    expect(callButtonHtml(on)).not.toMatch(/data-power-(dial|aura|chase)=/);
  });

  it("disabled, the lamp is cold, nothing charges or breathes, and the glyph is the unlit filament", () => {
    const off = screen(base, false);
    expect(off).toContain('data-power-dial="on"');
    expect(off).not.toContain("data-power-aura");
    expect(off).not.toContain("data-power-pilot");
    expect(off).not.toContain("data-power-chase");
    expect(off).not.toContain("data-power-plasma");
    expect(off).toContain('data-power-glyph="dark"');
  });

  it("a live call hides the dial and keeps an ember aura; a hang-up in progress drops it", () => {
    const live = screen(voice({ phase: "LISTENING" }));
    expect(live).toContain('data-power-dial="off"');
    expect(live).toContain('data-power-aura="ember"');
    expect(live).toContain('data-power-face="hangup"');
    expect(live).toContain("data-power-ignite");
    expect(screen(voice({ phase: "LISTENING", hangingUp: true }))).not.toContain("data-power-aura");
  });

  it("every loop is a transform or opacity animation, runs only with motion allowed, and pauses with the page", () => {
    const motion = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/.exec(POWER_CSS)?.[1] ?? "";
    for (const name of ["franki-power-breathe", "franki-power-pilot", "franki-power-turn", "franki-power-pop", "franki-power-flash"]) {
      expect(motion, name).toContain(`animation: ${name} `);
    }
    // No animation runs outside the motion queries.
    const outside = POWER_CSS.replace(/@media \(prefers-reduced-motion: no-preference\)[^{]*\{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/animation:/);
    // Keyframes change only transform and opacity.
    for (const block of POWER_CSS.match(/@keyframes [\s\S]*?\n\}/g) ?? []) {
      for (const [, prop] of block.matchAll(/([a-z-]+)\s*:/g)) expect(["transform", "opacity"], block).toContain(prop);
    }
    // Each animated element carries .franki-anim, so a forced reduced specimen stops it and a hidden tab pauses it.
    const on = screen(base);
    expect(on).toMatch(/data-power-pilot="" class="franki-anim"/);
    expect(on).toMatch(/data-power-chase-light="" class="franki-anim/);
    expect(on).toMatch(/data-power-face="start" class="franki-anim/);
  });
});
