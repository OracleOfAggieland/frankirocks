import { avatarState, initialVoiceState } from "@franki/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AVATAR_STATES, AVATAR_STYLES, StandInAvatar, avatarClasses } from "./StandInAvatar";

// The call-control tests moved to CallScreen.test.tsx (lab-ui-foundation task 16.7).

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

  it("shows recovery while the call is recovering", () => {
    const recovering = { ...initialVoiceState({ transcribeModel: "m" }), phase: "RECOVERY" as const, recovery: { kind: "connection" as const, since: 0, attempts: 3 } };
    expect(renderToStaticMarkup(<StandInAvatar state={avatarState(recovering)} />)).toContain('data-state="recovery"');
  });
});
