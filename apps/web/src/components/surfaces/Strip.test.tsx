import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StripProps } from "../../ui/surface-props";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import { LABEL_BOX, POST_PX, STRIP_LAYOUT, STRIP_LIST, Strip, newestTerminal, pulseWire } from "./Strip";

const html = (p: Partial<StripProps>) => renderToStaticMarkup(<Strip open filled={0} resultLabel="$115 less" {...p} />);

describe("Strip", () => {
  it.each([0, 1, 2, 3, 4, 5] as const)("renders five terminals with %i filled", (filled) => {
    const out = html({ filled });
    expect(out.match(/data-terminal=/g)).toHaveLength(5);
    expect(out.match(/data-on="true"/g)?.length ?? 0).toBe(filled);
    for (const label of ["Noticed", "Connected", "Suggested", "You said yes", "$115 less"]) expect(out).toContain(label);
  });

  // Brief 015: the fifth post is the shared gold material, so the pin moves from bg-gold to mat-gold.
  it("turns the last terminal gold only when filled", () => {
    expect(html({ filled: 5 })).toContain("mat-gold");
    expect(html({ filled: 4 })).not.toContain("mat-gold");
    expect(html({ filled: 4 })).not.toContain("bg-gold");
  });

  it("renders nothing when no loop is open", () => {
    expect(html({ open: false, filled: 3 })).toBe("");
  });

  it("gives every terminal a label box of one fixed width, at most two lines", () => {
    const out = html({ filled: 2 });
    const boxes = [...out.matchAll(/<span data-label-box="" class="([^"]*)"/g)].map((m) => m[1]);
    expect(boxes).toHaveLength(STRIP_LAYOUT.terminals);
    const widths = boxes.map((c) => c.split(" ").filter((k) => /^w-/.test(k)));
    for (const w of widths) expect(w).toEqual(["w-24"]);
    for (const c of boxes) {
      expect(c).toContain("line-clamp-2");
      expect(c).toContain("shrink-0");
    }
    // w-24 is 6rem, the labelRem the layout is computed from.
    expect(STRIP_LAYOUT.labelRem * 4).toBe(24);
  });

  it("leaves a gap between neighbouring label boxes in both layouts", () => {
    const { labelRem, gapRem, rowGapRem, acrossRem, terminals } = STRIP_LAYOUT;
    expect(gapRem).toBeGreaterThan(0);
    expect(rowGapRem).toBeGreaterThan(0);
    // Across: one track per terminal, each exactly the label box width, with the gap between tracks.
    expect(STRIP_LIST).toContain(`@min-[${acrossRem}rem]:grid-cols-[repeat(${terminals},${labelRem}rem)]`);
    expect(STRIP_LIST).toContain(`@min-[${acrossRem}rem]:gap-x-${gapRem * 4}`);
    // The column layout switches to across only where all five boxes and four gaps fit.
    expect(terminals * labelRem + (terminals - 1) * gapRem).toBeLessThanOrEqual(acrossRem);
    // Down: a row gap between terminals.
    expect(STRIP_LIST).toContain(`gap-y-${rowGapRem * 4}`);
    expect(LABEL_BOX).toContain(`@min-[${acrossRem}rem]:text-center`);
    // The across wire spans one track plus one gap; the down wire one row plus one row gap.
    const out = html({ filled: 5 });
    expect(out).toContain(`w-[calc(100%+${gapRem}rem)]`);
    expect(out).toContain(`h-[calc(100%+${rowGapRem}rem)]`);
  });

  it("lays the wire along both axes, lit up to the last filled terminal", () => {
    const out = html({ filled: 3 });
    expect(out.match(/data-wire-track="x"/g)).toHaveLength(4);
    expect(out.match(/data-wire-track="y"/g)).toHaveLength(4);
  });
});

const motionHtml = (reduced: boolean, filled: StripProps["filled"]) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced={reduced}>
      <Strip open filled={filled} resultLabel="$115 less" />
    </ReducedMotionOverride>,
  );

describe("Strip binding posts (brief 015)", () => {
  it("draws 14 px posts: an ink-dim ring at rest, an ecto core with the glow when filled", () => {
    expect(POST_PX).toBe(14);
    const posts = [...html({ filled: 2 }).matchAll(/<span data-node="" class="([^"]*)">([\s\S]*?)<\/span><span data-label-box/g)];
    expect(posts).toHaveLength(5);
    for (const [, cls] of posts) expect(cls).toContain("size-3.5");
    expect(posts[0][2]).toContain("bg-ecto shadow-ecto-glow");
    expect(posts[2][1]).toContain("border-ink-dim");
    expect(posts[2][2]).not.toContain("bg-ecto");
  });

  it("runs the wires through the post centre", () => {
    const out = html({ filled: 3 });
    // A 2 px wire centred on a 14 px post starts 6 px in.
    expect(out).toContain("top-[6px]");
    expect(out).toContain("left-[6px]");
    expect(POST_PX / 2 - 1).toBe(6);
  });

  it("draws the track dashed and the filled wire solid ecto", () => {
    const out = html({ filled: 3 });
    expect(out.match(/franki-strip-track-x/g)).toHaveLength(4);
    expect(out.match(/franki-strip-track-y/g)).toHaveLength(4);
    expect(motionHtml(true, 3).match(/data-wire="\d" data-axis="x" class="absolute inset-0 bg-ecto"/g)).toHaveLength(2);
  });

  it("sends one pulse along the newest filled segment while the loop is open and not complete", () => {
    expect(pulseWire(0)).toBeNull();
    expect(pulseWire(1)).toBeNull();
    expect(pulseWire(2)).toBe(0);
    expect(pulseWire(4)).toBe(2);
    expect(pulseWire(5)).toBeNull();
    const out = motionHtml(false, 3);
    // One pulse per axis on the same wire; only one shows at a time, by container width.
    expect(out.match(/data-pulse=/g)).toHaveLength(2);
    expect(out).toMatch(/data-wire-track="x"[^>]*>(?:(?!data-wire-track)[\s\S])*data-wire="1"(?:(?!data-wire-track)[\s\S])*data-pulse="x"/);
    expect(motionHtml(false, 5)).not.toContain("data-pulse=");
    expect(motionHtml(false, 1)).not.toContain("data-pulse=");
    expect(motionHtml(true, 3)).not.toContain("data-pulse=");
  });

  it("bursts six gold rays at the fifth post, only when it fills and motion is allowed", () => {
    const out = motionHtml(false, 5);
    const burst = /<svg[^>]*data-burst=""[^>]*>([\s\S]*?)<\/svg>/.exec(out);
    expect(burst).not.toBeNull();
    expect(burst![1].match(/<line /g)).toHaveLength(6);
    expect(burst![1]).toContain('stroke="var(--color-gold)"');
    expect(motionHtml(false, 4)).not.toContain("data-burst");
    expect(motionHtml(true, 5)).not.toContain("data-burst");
  });

  it("sets labels in mono 12, the newest in ink and the rest in ink-dim", () => {
    expect(newestTerminal(0)).toBeNull();
    expect(newestTerminal(3)).toBe(2);
    for (const filled of [0, 1, 2, 3, 4, 5] as const) {
      const boxes = [...html({ filled }).matchAll(/<span data-label-box="" class="([^"]*)"/g)].map((m) => m[1]);
      boxes.forEach((c, i) => {
        expect(c).toContain("font-mono");
        expect(c).toContain("text-xs");
        expect(c).toContain(i === filled - 1 ? "text-ink" : "text-ink-dim");
        if (i !== filled - 1) expect(c).not.toMatch(/text-ink(?!-)/);
      });
    }
  });
});

describe("Strip gold post timing (brief 015 review)", () => {
  it("keeps the fifth post's ring at rest and lights its gold on the delayed core", () => {
    const out = motionHtml(false, 5);
    const fifth = /<li data-terminal="4"[\s\S]*?<\/li>/.exec(out)![0];
    expect(fifth).toMatch(/<span data-node="" class="[^"]*border-ink-dim bg-night-1"/);
    expect(fifth).not.toMatch(/data-node="" class="[^"]*mat-gold/);
    expect(fifth).toMatch(/class="franki-anim franki-strip-core mat-gold [^"]*"/);
  });
});
