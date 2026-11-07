import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LOOK_NAMES, lookFor } from "../../ui/avatar/look";
import type { AvatarInput, LookName } from "../../ui/avatar/types";
import { Avatar } from "./Avatar";
import { squishScale } from "./SvgGhost";

const base: AvatarInput = {
  state: "listening", micMuted: false, outputMuted: false, inputLevel: 0, outputLevel: 0,
  event: null, eventElapsedMs: 0, firstConnecting: false, reducedMotion: false,
};
const BY_NAME: Record<LookName, Partial<AvatarInput>> = {
  Dormant: { state: "closed" },
  Waking: { state: "connecting", firstConnecting: true },
  Connecting: { state: "connecting" },
  Listening: { state: "listening" },
  Thinking: { state: "thinking" },
  Speaking: { state: "speaking" },
  Recovery: { state: "recovery" },
  Presenting: { state: "listening", event: "present-card" },
  Awaiting_Approval: { state: "listening", event: "await-approval" },
  Celebrate: { state: "listening", event: "celebrate" },
};
const render = (patch: Partial<AvatarInput>) => {
  const input = { ...base, ...patch };
  return renderToStaticMarkup(<Avatar look={lookFor(input)} input={input} />);
};
const squishAttr = (html: string) => /data-squish="([^"]+)"/.exec(html)?.[1];

describe("SvgGhost", () => {
  it.each(LOOK_NAMES.flatMap((n) => [[n, false], [n, true]] as const))("%s (reduced=%s) draws every named part and no mouth", (name, reducedMotion) => {
    const html = render({ ...BY_NAME[name], reducedMotion });
    expect(html).toContain("<svg");
    for (const part of ["hem", "hair", "bolt-left", "bolt-right", "scar", "eye-left", "eye-right"]) {
      expect(html, part).toContain(`data-part="${part}"`);
    }
    expect(html).not.toMatch(/data-part="mouth"|mouth/i);
    expect(html).not.toMatch(/<(img|video|audio|canvas|image)\b/);
    expect(html).toContain('role="img"');
    expect(html).toContain(`aria-label="${lookFor({ ...base, ...BY_NAME[name] }).label}"`);
    expect(html).toContain(`data-look="${name}"`);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("squishes with the output level only while Speaking audibly", () => {
    expect(squishAttr(render({ state: "speaking", outputLevel: 0 }))).toBe("1.000");
    expect(Number(squishAttr(render({ state: "speaking", outputLevel: 0.8 })))).toBeLessThan(1);
    expect(squishAttr(render({ state: "speaking", outputMuted: true, outputLevel: 0.8 }))).toBe("1.000");
    expect(squishAttr(render({ state: "speaking", outputLevel: 0.8, reducedMotion: true }))).toBe("1.000");
    expect(squishScale(lookFor({ ...base, state: "listening", inputLevel: 1 }))).toEqual({ sx: 1, sy: 1 });
  });

  it("floats only with Reduced_Motion off", () => {
    expect(render({})).toContain("franki-float");
    expect(render({ reducedMotion: true })).not.toContain("franki-float");
    expect(render({ reducedMotion: true })).not.toContain("feGaussianBlur");
    expect(render({})).toContain("feGaussianBlur");
  });

  it("ghost mode fades the body, not the eyes", () => {
    const html = render({ micMuted: true });
    expect(html).toContain('data-ghost="true"');
    expect(html).toMatch(/data-part="body-group" opacity="0.35"/);
    expect(html).toMatch(/data-part="eyes" opacity="1"/);
  });
});
