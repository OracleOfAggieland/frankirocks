import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { contrastRatio } from "../../ui/contrast";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import { COLOR } from "../../ui/motion";
import type { MoteKind } from "../../ui/surface-props";
import { JAR_CAP, JAR_FILL, JAR_GLASS, Jar, moteLoop, motePosition, moteStage } from "./Jar";

const motes = (n: number, kind: MoteKind = "told") => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, kind }));

describe("Jar", () => {
  it("draws one mote per memory up to the cap of 48", () => {
    expect(renderToStaticMarkup(<Jar motes={motes(5)} onOpen={() => {}} />).match(/data-mote=/g)).toHaveLength(5);
    expect(renderToStaticMarkup(<Jar motes={motes(80)} onOpen={() => {}} />).match(/data-mote=/g)).toHaveLength(JAR_CAP);
    expect(JAR_CAP).toBe(48);
  });

  it("codes motes by kind: solid, dashed, brass and frosted", () => {
    const html = renderToStaticMarkup(
      <Jar motes={[{ id: "a", kind: "told" }, { id: "b", kind: "guessed" }, { id: "c", kind: "rule" }, { id: "d", kind: "private" }]} onOpen={() => {}} />,
    );
    expect(html).toMatch(/data-mote="told"[^>]*fill="var\(--color-ecto\)"/);
    expect(html).toMatch(/data-mote="guessed"[^>]*fill="none"[^>]*stroke-dasharray/);
    expect(html).toMatch(/data-mote="rule"[^>]*fill="var\(--color-brass\)"/);
    expect(html).toMatch(/data-mote="private"[^>]*opacity="0.35"/);
  });

  it("is a button named What I know that calls onOpen", () => {
    const onOpen = vi.fn();
    const el = Jar({ motes: motes(1), onOpen });
    expect(renderToStaticMarkup(<Jar motes={motes(1)} onOpen={onOpen} />)).toContain('aria-label="What I know"');
    (el as { props: { onClick: () => void } }).props.onClick();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders nothing with no motes", () => {
    expect(renderToStaticMarkup(<Jar motes={[]} onOpen={() => {}} />)).toBe("");
  });
});

const html = (reduced: boolean, n = 4) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced={reduced}>
      <Jar motes={motes(n)} onOpen={() => {}} />
    </ReducedMotionOverride>,
  );

describe("Jar drawing (Brief 004 item 6)", () => {
  it("is a glass specimen jar: rounded shoulders, a short neck, a brass lid with a rim and two rivets", () => {
    const out = html(true);
    // Shoulders are curves, the neck a short straight run under the lid.
    expect(JAR_GLASS).toMatch(/^M28 21 V27 C/);
    expect(JAR_GLASS.match(/C/g)).toHaveLength(2);
    expect(out).toContain('data-jar-part="lid"');
    expect(out).toMatch(/data-jar-part="rim"[^>]*fill="var\(--color-brass\)"/);
    expect(out.match(/data-jar-part="rivet"/g)).toHaveLength(2);
  });

  it("has two thin vertical highlight streaks and a faint ecto fill at the bottom", () => {
    const out = html(true);
    const streaks = /<g data-jar-part="highlights"[^>]*>([\s\S]*?)<\/g>/.exec(out)![1];
    const rects = [...streaks.matchAll(/width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({ w: Number(m[1]), h: Number(m[2]) }));
    expect(rects).toHaveLength(2);
    for (const r of rects) expect(r.h).toBeGreaterThan(r.w * 8);
    expect(out).toMatch(/data-jar-part="ecto-fill"[^>]*fill="url\(#franki-jar-ecto\)"/);
    expect(out).toMatch(/<linearGradient id="franki-jar-ecto"[\s\S]*?stop-color="var\(--color-ecto\)" stop-opacity="0.28"/);
  });

  it("carries a brass label plate reading What I know, in 12 px night-0 on brass", () => {
    const plate = /<g data-jar-part="plate">([\s\S]*?)<\/g>/.exec(html(true))![1];
    expect(plate).toContain('fill="url(#franki-jar-brass)"');
    expect(plate).toMatch(/<text[^>]*class="fill-night-0 font-sans text-xs"[^>]*>What I know<\/text>/);
    expect(contrastRatio(COLOR["night-0"], COLOR.brass)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every mote above the plate and inside the glass", () => {
    for (let i = 0; i < JAR_CAP; i++) {
      const p = motePosition(i);
      const loop = moteLoop(i);
      expect(p.y + 2.6 + Math.abs(loop.dy)).toBeLessThan(99);
      expect(p.y - 2.6 - Math.abs(loop.dy)).toBeGreaterThan(36);
      expect(p.x - 2.6 - Math.abs(loop.dx)).toBeGreaterThan(10);
      expect(p.x + 2.6 + Math.abs(loop.dx)).toBeLessThan(86);
    }
  });

  it("motes drift on spring.float, each on its own loop, and sit still under Reduced_Motion", () => {
    expect(html(false).match(/data-drift="true"/g)).toHaveLength(4);
    expect(html(true)).not.toContain('data-drift="true"');
    expect(html(true).match(/data-drift="false"/g)).toHaveLength(4);
    const loops = Array.from({ length: JAR_CAP }, (_, i) => moteLoop(i));
    for (const l of loops) {
      expect(Math.abs(l.dx)).toBeGreaterThan(0);
      expect(Math.abs(l.dy)).toBeGreaterThan(0);
      expect(l.delayX).not.toBe(l.delayY);
    }
    expect(new Set(loops.map((l) => `${l.dx},${l.dy},${l.delayX},${l.delayY}`)).size).toBeGreaterThan(JAR_CAP / 2);
  });
});

const motionHtml = (reduced: boolean, extra: { arrivingIds?: string[]; leavingIds?: string[] } = {}) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced={reduced}>
      <Jar motes={motes(4)} onOpen={() => {}} {...extra} />
    </ReducedMotionOverride>,
  );

describe("Jar glass, glow and lid (brief 015)", () => {
  it("shades the glass like a cylinder, with a meniscus, a refraction band and a shadow in the base", () => {
    const out = html(true);
    expect(out).toMatch(/data-jar-part="glass"[^>]*fill="url\(#franki-jar-body\)"/);
    expect(out).toMatch(/<linearGradient id="franki-jar-body"[\s\S]*?<\/linearGradient>/);
    // The fill's surface climbs both walls: it starts and ends higher than its middle.
    expect(JAR_FILL).toMatch(/^M8 81 Q11 86\.5 20 87 H76 Q85 86\.5 88 81/);
    expect(out).toContain('data-jar-part="meniscus"');
    expect(out).toMatch(/data-jar-part="refraction"[^>]*fill="url\(#franki-jar-refraction\)"/);
    expect(out).toMatch(/data-jar-part="base-shadow"[^>]*fill="url\(#franki-jar-base-shadow\)"/);
  });

  it("knurls the lid's rim and engraves the plate", () => {
    const out = html(true);
    const knurl = /<g data-jar-part="knurl"[^>]*>([\s\S]*?)<\/g>/.exec(out)![1];
    expect(knurl.match(/<line /g)!.length).toBeGreaterThanOrEqual(20);
    const plate = /<g data-jar-part="plate">([\s\S]*?)<\/g>/.exec(out)![1];
    // An engraved word: a faint light copy just under the dark one.
    expect(plate.match(/>What I know<\/text>/g)).toHaveLength(2);
    expect(plate).toMatch(/<text[^>]*aria-hidden="true"[^>]*class="fill-spark/);
  });

  it("gives the motes a soft glow: one blurred copy of the mote group", () => {
    const out = motionHtml(false);
    const use = /<use data-jar-glow="" href="#([^"]+)" filter="url\(#franki-jar-mote-glow\)"/.exec(out);
    expect(use).not.toBeNull();
    expect(out).toContain(`<g id="${use![1]}" data-jar-part="motes"`);
    expect(out.match(/<use /g)).toHaveLength(1);
    expect(out).toContain("<feGaussianBlur");
  });

  it("twinkles each mote around its own resting opacity, only while motion is allowed", () => {
    const out = motionHtml(false);
    expect(out.match(/franki-mote-twinkle/g)).toHaveLength(4);
    expect(out).toContain("--mote-o:0.9");
    expect(motionHtml(true)).not.toContain("franki-mote-twinkle");
  });

  it("materializes arriving motes and dematerializes leaving ones", () => {
    expect(moteStage("a", ["a"], [])).toBe("arriving");
    expect(moteStage("a", [], ["a"])).toBe("leaving");
    expect(moteStage("a", ["a"], ["a"])).toBe("leaving");
    expect(moteStage("a")).toBe("still");
    const out = motionHtml(false, { arrivingIds: ["m1"], leavingIds: ["m2"] });
    expect(out.match(/data-mote-stage="arriving"/g)).toHaveLength(1);
    expect(out.match(/data-mote-stage="leaving"/g)).toHaveLength(1);
    expect(out.match(/data-mote-stage="still"/g)).toHaveLength(2);
    // An arriving mote starts below its place and unseen.
    expect(out).toMatch(/data-mote-stage="arriving" style="[^"]*translateY\(12px\)[^"]*opacity:0/);
    // Every mote is still drawn while it leaves, so the caller decides when it is dropped.
    expect(out.match(/data-mote=/g)).toHaveLength(4);
    // Under reduced motion an arriving mote only fades.
    const calm = motionHtml(true, { arrivingIds: ["m1"] });
    expect(calm).toMatch(/data-mote-stage="arriving" style="opacity:0"/);
  });
});


describe("Jar glow region and mote slots (brief 015 review)", () => {
  it("blurs over the whole drawing, so a single row of motes keeps its full glow", () => {
    expect(motionHtml(false)).toMatch(/<filter id="franki-jar-mote-glow" filterUnits="userSpaceOnUse" x="0" y="0" width="96" height="128"/);
  });

  it("carries each mote's slot as a transform and draws the drifting circle at the origin", () => {
    const out = motionHtml(false);
    expect(out.match(/data-mote-slot=""/g)).toHaveLength(4);
    for (const m of out.matchAll(/<circle [^>]*data-drift="true"[^>]*>/g)) {
      expect(m[0]).toContain('cx="0"');
      expect(m[0]).toContain('cy="0"');
    }
    const { x, y } = motePosition(1);
    expect(out).toContain(`translateX(${x}px) translateY(${y}px)`);
  });
});
