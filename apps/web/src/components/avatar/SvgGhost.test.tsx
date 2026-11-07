import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LOOK_NAMES, lookFor } from "../../ui/avatar/look";
import type { AvatarInput, LookName } from "../../ui/avatar/types";
import { Avatar } from "./Avatar";
import { BODY, HAIR, HAIR_TUFTS, HEM, SCAR_STITCHES, squishScale } from "./SvgGhost";

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

/** Path commands of an SVG path, upper-cased. */
const commands = (d: string) => (d.match(/[a-z]/gi) ?? []).map((c) => c.toUpperCase());

describe("SvgGhost drawing (Brief 004 item 4)", () => {
  it("draws the body as one smooth closed path of curves, with no straight edge", () => {
    const c = commands(BODY);
    expect(c[0]).toBe("M");
    expect(c.at(-1)).toBe("Z");
    expect(c.filter((k) => k === "M")).toHaveLength(1);
    expect(c.slice(1, -1).every((k) => k === "C")).toBe(true);
  });

  it("is widest across the head and tapers into three hem lobes of unequal size", () => {
    const nums = BODY.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    // Segment endpoints: M, then every third point of each C.
    const ends = [pts[0], ...pts.slice(1).filter((_, i) => i % 3 === 2)];
    const widest = ends.reduce((a, b) => (b.x > a.x ? b : a));
    expect(widest.y).toBeLessThan(110);
    // The hem lobes: the three C segments that end on the notches and the left lobe end.
    const lobes = [[ends[3], ends[4]], [ends[4], ends[5]], [ends[5], ends[6]]].map(([p, q]) => Math.abs(p.x - q.x));
    expect(new Set(lobes).size).toBe(3);
    expect(HEM.startsWith(`M${ends[3].x} ${ends[3].y}`)).toBe(true);
  });

  it("draws hair with a flat top and a ragged fringe, not a rectangle", () => {
    const c = commands(HAIR);
    expect(c.slice(1, -1).every((k) => k === "C")).toBe(true);
    // Five tufts hanging to uneven depths, each well below its valley.
    expect(HAIR_TUFTS).toHaveLength(5);
    expect(new Set(HAIR_TUFTS.map((t) => t.tip.y)).size).toBe(5);
    for (const t of HAIR_TUFTS) {
      expect(t.tip.y - t.valley.y).toBeGreaterThanOrEqual(15);
      expect(HAIR).toContain(` ${t.tip.x} ${t.tip.y}`);
    }
  });

  it("has three or four crossing stitches on a curved scar", () => {
    expect(SCAR_STITCHES.length).toBeGreaterThanOrEqual(3);
    expect(SCAR_STITCHES.length).toBeLessThanOrEqual(4);
    const html = render({});
    expect(html).toMatch(/data-part="scar-seam" d="M[\d. ]+Q/);
    expect(html.match(/data-part="stitch"/g)).toHaveLength(SCAR_STITCHES.length);
  });

  it("shades with a vertical ghost gradient, an ecto rim and one specular highlight, bolts as brass cylinders", () => {
    const html = render({});
    expect(html).toMatch(/<linearGradient id="franki-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var\(--color-ghost\)"/);
    expect(html).toContain('stop-color="var(--color-ghost-deep)"');
    expect(html).toMatch(/data-part="rim"[^>]*stroke="var\(--color-ecto\)"/);
    expect(html.match(/data-part="specular"/g)).toHaveLength(1);
    expect(html.match(/data-part="bolt-shaft"[^>]*fill="url\(#franki-bolt\)"/g)).toHaveLength(2);
    expect(html.match(/data-part="bolt-cap"/g)).toHaveLength(2);
    const boltGradient = /<linearGradient id="franki-bolt"[\s\S]*?<\/linearGradient>/.exec(html)?.[0] ?? "";
    expect(boltGradient).toContain('"var(--color-brass)"');
    expect(boltGradient).toContain('"var(--color-brass-hi)"');
  });

  it("draws the same body, hair, scar and shading under Reduced_Motion", () => {
    const part = (html: string, name: string) => new RegExp(`<[a-z]+ data-part="${name}"[^>]*>`).exec(html)?.[0];
    for (const name of LOOK_NAMES) {
      const full = render({ ...BY_NAME[name], reducedMotion: false });
      const calm = render({ ...BY_NAME[name], reducedMotion: true });
      for (const p of ["body", "rim", "hair", "hair-highlight", "hem", "specular", "scar-seam"]) {
        expect(part(calm, p), `${name} ${p}`).toBe(part(full, p));
      }
    }
  });
});
