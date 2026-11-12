import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LOOK_NAMES, lookFor } from "../../ui/avatar/look";
import type { AvatarInput, LookName } from "../../ui/avatar/types";
import { Avatar } from "./Avatar";
import { ARC_WAYPOINTS, BODY, HAIR, HAIR_TUFTS, HEM, SCAR_STITCHES, SPECULAR, STRIKE_WAYPOINTS, SvgGhost, ghostDefIds, squishScale } from "./SvgGhost";

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
  return renderToStaticMarkup(<Avatar look={lookFor(input)} input={input} renderer={SvgGhost} />);
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

  it("draws hair as a cap over the dome with a ragged fringe, not a slab on a box", () => {
    const c = commands(HAIR);
    expect(c.slice(1, -1).every((k) => k === "C")).toBe(true);
    // Five chunky tufts hanging to uneven depths, each well below its valley.
    expect(HAIR_TUFTS).toHaveLength(5);
    expect(new Set(HAIR_TUFTS.map((t) => t.tip.y)).size).toBe(5);
    for (const t of HAIR_TUFTS) {
      expect(t.tip.y - t.valley.y).toBeGreaterThanOrEqual(12);
      expect(HAIR).toContain(` ${t.tip.x} ${t.tip.y}`);
    }
    // The cap sits just above the dome, and its temples hang slightly over both sides of the head.
    const yOf = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 1);
    const xOf = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0);
    const domeTop = Math.min(...yOf(BODY));
    const hairTop = Math.min(...yOf(HAIR));
    expect(hairTop).toBeLessThan(domeTop);
    expect(domeTop - hairTop).toBeLessThanOrEqual(14);
    const [hairStartX] = xOf(HAIR);
    const [bodyStartX] = xOf(BODY);
    expect(hairStartX).toBeLessThan(bodyStartX);
    expect(Math.max(...xOf(HAIR))).toBeGreaterThan(Math.max(...xOf(BODY.split(" C")[2])));
  });

  it("puffs out into a soft bulge at the lower left, wider than the head", () => {
    const nums = BODY.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    const leftmost = xs.indexOf(Math.min(...xs));
    // The leftmost point is low on the body, well out past the head's left side.
    expect(ys[leftmost]).toBeGreaterThan(130);
    expect(xs[0] - xs[leftmost]).toBeGreaterThanOrEqual(20);
  });

  it("places the specular highlight on the upper-left cheek, below the hair", () => {
    const html = render({});
    expect(html).toMatch(/data-part="specular" d="M[\d. ]+A[\d. ]+A[\d. ]+Z"/);
    const { cx, cy, ry } = SPECULAR;
    expect(cx).toBeLessThan(100);
    for (const t of HAIR_TUFTS.filter((tuft) => tuft.tip.x < 100)) expect(cy - ry).toBeGreaterThan(t.tip.y);
    // No rotate() with a centre point anywhere: globals.css re-bases avatar transforms on each fill box.
    expect(html).not.toMatch(/rotate\(-?[\d.]+ /);
  });

  it("starts the electricity exactly at the bolt cap faces", () => {
    const html = render({});
    const caps = [...html.matchAll(/data-part="bolt-cap" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    expect(caps).toEqual([ARC_WAYPOINTS[0], ARC_WAYPOINTS.at(-1)]);
    expect(STRIKE_WAYPOINTS.map((w) => w.at(-1))).toEqual(caps);
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
    const bodyId = /<linearGradient id="(franki-body-[^"]+)" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var\(--color-ghost\)"/.exec(html)?.[1];
    expect(bodyId).toBeDefined();
    expect(html).toContain(`data-part="body" d="${BODY}" fill="url(#${bodyId})"`);
    expect(html).toContain('stop-color="var(--color-ghost-deep)"');
    expect(html).toMatch(/data-part="rim"[^>]*stroke="var\(--color-ecto\)"/);
    expect(html.match(/data-part="specular"/g)).toHaveLength(1);
    const boltGradient = /<linearGradient id="(franki-bolt-(?!gold)[^"]+)"[\s\S]*?<\/linearGradient>/.exec(html);
    expect(boltGradient).not.toBeNull();
    expect(html.match(new RegExp(`data-part="bolt-shaft"[^>]*fill="url\\(#${boltGradient![1]}\\)"`, "g"))).toHaveLength(2);
    expect(html.match(/data-part="bolt-cap"/g)).toHaveLength(2);
    expect(boltGradient![0]).toContain('"var(--color-brass)"');
    expect(boltGradient![0]).toContain('"var(--color-brass-hi)"');
  });

  it("gives every def a per-instance id, so many ghosts on one page never share a gradient", () => {
    const listening = { ...base, state: "listening" as const };
    const celebrate = { ...base, event: "celebrate" as const };
    const html = renderToStaticMarkup(
      <>
        <Avatar look={lookFor(listening)} input={listening} renderer={SvgGhost} />
        <Avatar look={lookFor(celebrate)} input={celebrate} renderer={SvgGhost} />
      </>,
    );
    const svgs = html.split("<svg").slice(1);
    expect(svgs).toHaveLength(2);
    const idsOf = (svg: string) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const [a, b] = svgs.map(idsOf);
    expect(a.length).toBeGreaterThanOrEqual(7);
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
    for (const svg of svgs) {
      const own = new Set(idsOf(svg));
      for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) {
        // Electricity's shared bolt-glow filter is the one fixed id; every ghost def is the ghost's own.
        if (ref.startsWith("franki-bolt-glow")) continue;
        expect(own.has(ref), ref).toBe(true);
        expect(ref).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
      }
    }
    // Each ghost's glow gradient carries its own look's colour.
    const glowStop = (svg: string) => /<radialGradient id="franki-glow-gradient-[^"]+"><stop offset="0%" stop-color="([^"]+)"/.exec(svg)?.[1];
    expect(glowStop(svgs[0])).toBe("var(--color-ecto)");
    expect(glowStop(svgs[1])).toBe("var(--color-gold)");
  });

  it("cleans useId values into ids that work inside url(#...)", () => {
    const ids = ghostDefIds(":r1:");
    expect(ids.body).toBe("franki-body-_r1_");
    expect(Object.values(ids).every((id) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(id))).toBe(true);
    expect(ghostDefIds("«r2»").glowGradient).not.toBe(ghostDefIds("«r3»").glowGradient);
  });

  it("draws the same body, hair, scar and shading under Reduced_Motion", () => {
    const part = (html: string, name: string) => new RegExp(`<[a-z]+ data-part="${name}"[^>]*>`).exec(html)?.[0];
    for (const name of LOOK_NAMES) {
      const full = render({ ...BY_NAME[name], reducedMotion: false });
      const calm = render({ ...BY_NAME[name], reducedMotion: true });
      for (const p of ["body", "shade", "rim", "hair", "hair-strands", "hair-highlight", "hem", "specular", "scar-seam"]) {
        expect(part(calm, p), `${name} ${p}`).toBe(part(full, p));
      }
    }
  });
});
