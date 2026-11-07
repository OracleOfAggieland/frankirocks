// Call controls (FSC R16.4 to R16.6, R13.8, R15.8; lab-ui-foundation R14.4 to R14.6). Moved from
// StandInAvatar.test.tsx; the class assertions follow the token classes of R14.4.
import { type VoiceState, initialVoiceState } from "@franki/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CALL_ERRORS, CallScreen } from "./CallScreen";

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
    expect(screen(voice({ error: "open" }))).toContain(CALL_ERRORS.open);
    expect(screen(voice({ error: "close" }))).toContain(CALL_ERRORS.close);
    expect(screen(voice({ error: "open" }))).toContain('data-step="open"');
    const recovering = voice({ phase: "RECOVERY", recovery: { kind: "connection", since: 0, attempts: 3 } });
    expect(screen(recovering)).not.toContain(">Retry<");
    expect(screen({ ...recovering, retryVisible: true })).toContain(">Retry<");
  });

  it("every control has a visible focus style", () => {
    const html = screen(voice({ phase: "LISTENING" }));
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html.match(/focus-visible:outline-2/g)?.length).toBe(2);
  });
});
