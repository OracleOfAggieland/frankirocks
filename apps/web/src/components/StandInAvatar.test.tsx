import { type VoiceState, initialVoiceState } from "@franki/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CALL_ERRORS, CallScreen } from "./CallScreen";
import { AVATAR_STATES, AVATAR_STYLES, StandInAvatar, avatarClasses } from "./StandInAvatar";

const noop = () => {};
const base = initialVoiceState({ transcribeModel: "m" });
const voice = (patch: Partial<VoiceState>): VoiceState => ({ ...base, ...patch });
const screen = (v: VoiceState, enabled = true) =>
  renderToStaticMarkup(<CallScreen voice={v} enabled={enabled} onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />);

describe("Stand_In_Avatar (R16.1–R16.3)", () => {
  it("six states with distinct non-text styling and accessible labels", () => {
    expect(AVATAR_STATES).toEqual(["closed", "connecting", "listening", "thinking", "speaking", "recovery"]);
    for (const a of AVATAR_STATES) {
      for (const b of AVATAR_STATES) {
        if (a === b) continue;
        const sa = AVATAR_STYLES[a];
        const sb = AVATAR_STYLES[b];
        const differs = sa.shape !== sb.shape || sa.size !== sb.size || sa.colour !== sb.colour || sa.animation !== sb.animation;
        expect(differs, `${a} vs ${b}`).toBe(true);
        expect(avatarClasses(a)).not.toBe(avatarClasses(b));
      }
      const html = renderToStaticMarkup(<StandInAvatar state={a} />);
      expect(html).toContain(`aria-label="Franki is ${a}"`);
      expect(html).toContain(`data-state="${a}"`);
      expect(html).toContain('role="img"');
      // Plain HTML and CSS only: no image, video, canvas or Rive.
      expect(html).not.toMatch(/<(img|video|canvas|svg)\b/);
      expect(html).not.toMatch(/rive/i);
    }
  });
});

describe("call controls (R16.4–R16.6)", () => {
  it("one call button: start form while closed, hang-up form otherwise, with a non-text difference", () => {
    const closed = screen(base);
    const live = screen(voice({ phase: "LISTENING" }));
    expect(closed.match(/data-form=/g)).toHaveLength(1);
    expect(live.match(/data-form=/g)).toHaveLength(1);
    expect(closed).toContain('data-form="start"');
    expect(live).toContain('data-form="hangup"');
    const cls = (html: string) => /data-form="[^"]+"[^>]*class="([^"]+)"/.exec(html)?.[1];
    expect(cls(closed)).toContain("bg-ecto");
    expect(cls(live)).toContain("bg-ember");
    expect(cls(live)).not.toContain("bg-ecto");
    expect(cls(closed)).toContain("rounded-full");
    expect(cls(live)).not.toContain("rounded-full");
  });

  it("mute toggle only while listening, thinking or speaking, and shows when the mic is muted", () => {
    const shown = (v: VoiceState) => screen(v).includes("microphone");
    expect(shown(base)).toBe(false);
    expect(shown(voice({ phase: "CONNECTING" }))).toBe(false);
    expect(shown(voice({ phase: "RECOVERY", recovery: { kind: "line", since: 0, attempts: 0 } }))).toBe(false);
    for (const phase of ["LISTENING", "HELD", "SPEAKING", "TOOL_WAIT", "WAIT_ITEM"] as const) expect(shown(voice({ phase })), phase).toBe(true);
    const muted = screen(voice({ phase: "LISTENING", micMuted: true }));
    expect(muted).toContain('aria-pressed="true"');
    expect(muted).toContain('data-testid="muted-indicator"');
  });

  it("disabled while signed out, while a hang-up is in progress, and while an open is pending", () => {
    expect(screen(base, false)).toMatch(/data-form="start"[^>]*disabled=""/);
    expect(screen(voice({ hangingUp: true }))).toMatch(/data-form="start"[^>]*disabled=""/);
    expect(screen(base)).not.toMatch(/data-form="start"[^>]*disabled=""/);
  });

  it("names the failed step and offers retry after 30 s of recovery", () => {
    expect(screen(voice({ error: "open" }))).toContain(CALL_ERRORS.open);
    expect(screen(voice({ error: "close" }))).toContain(CALL_ERRORS.close);
    const recovering = voice({ phase: "RECOVERY", recovery: { kind: "connection", since: 0, attempts: 3 } });
    expect(screen(recovering)).not.toContain(">Retry<");
    expect(screen({ ...recovering, retryVisible: true })).toContain(">Retry<");
    expect(screen(recovering)).toContain('data-state="recovery"');
  });
});
