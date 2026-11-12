"use client";
// Card extras (brief 015, package C): a source card with its rows open, the same card under reduced motion,
// the rows on their own, the five kind glyphs, the seal, and the chips with and without motion.
import { Card, KindGlyph } from "../../../components/surfaces/Card";
import { Chips } from "../../../components/surfaces/Chips";
import { Seal } from "../../../components/surfaces/Seal";
import { Seam } from "../../../components/surfaces/Seam";
import { type SourceRow, SourceRows } from "../../../components/surfaces/SourceRows";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import type { CardKind, CardProps } from "../../../ui/surface-props";
import { Section, Tile } from "./Section";

const noop = () => {};

const ROWS: SourceRow[] = [
  { id: "row-1", when: "Thu Oct 2", what: "Noodles, delivered", amount: "$30" },
  { id: "row-2", when: "Tue Oct 7", what: "Pizza, delivered", amount: "$28" },
  { id: "row-3", when: "Thu Oct 9", what: "Curry, takeout", amount: "$34" },
  { id: "row-4", when: "Tue Oct 14", what: "Tacos, delivered", amount: "$34" },
  { id: "row-5", when: "Thu Oct 16", what: "Pho, takeout", amount: "$24" },
  { id: "row-6", when: "Thu Oct 23", what: "Burgers, delivered", amount: "$36" },
];

const SOURCE_ROWS = { bank: ROWS } as const;

const TAKEOUT: CardProps = {
  kind: "source",
  id: "extras-takeout",
  title: "Takeout nights",
  sources: [
    { id: "bank", label: "Bank · 6 purchases" },
    { id: "cal", label: "Calendar · 4 meetings" },
  ],
  onOpenSource: noop,
  body: "Mostly on nights with meetings after 6.",
  figures: [
    { label: "This month", value: "$186", sourceId: "bank" },
    { label: "Late meetings", value: "4", sourceId: "cal" },
  ],
};

const KINDS: CardKind[] = ["source", "approval", "food", "ask", "read"];
const CHIPS = ["What do you know about me?", "What's on today?", "Plan dinner"] as const;

export function CardExtrasSection() {
  return (
    <ReducedMotionOverride reduced={false}>
      <Section id="card-extras" title="Card extras">
        <Tile label="source card, rows open" data-specimen="card-rows">
          <div className="w-[343px]">
            <Card {...TAKEOUT} sourceRows={SOURCE_ROWS} defaultOpenSource="bank" />
          </div>
        </Tile>
        <Tile label="source card, rows open, reduced motion" data-specimen="card-rows-reduced">
          <ReducedMotionOverride reduced>
            <div data-reduced="true" className="w-[343px]">
              <Card {...TAKEOUT} id="extras-takeout-reduced" sourceRows={SOURCE_ROWS} defaultOpenSource="bank" />
            </div>
          </ReducedMotionOverride>
        </Tile>
        <Tile label="source card, rows closed (tap a tag)" data-specimen="card-rows-closed">
          <div className="w-[343px]">
            <Card {...TAKEOUT} id="extras-takeout-closed" sourceRows={SOURCE_ROWS} />
          </div>
        </Tile>
        <Tile label="source rows at 311 px (inside a 375 px card)" data-specimen="source-rows">
          <div className="w-[311px]">
            <SourceRows label="Bank · 6 purchases" rows={ROWS} />
          </div>
        </Tile>
        <Tile label="kind glyphs, 16 px" data-specimen="kind-glyphs">
          <ul className="mat-glass flex gap-4 rounded-card p-4 text-ink-dim">
            {KINDS.map((k) => (
              <li key={k} className="flex flex-col items-center gap-2">
                <KindGlyph kind={k} />
                <span className="font-mono text-xs">{k}</span>
              </li>
            ))}
          </ul>
        </Tile>
        <Tile label="seal on glass, and a seam" data-specimen="seal">
          <div className="mat-glass flex w-48 flex-col gap-3 rounded-card p-4">
            <Seam />
            <span className="flex items-center gap-2 text-sm text-ink">
              <Seal />
              No shellfish
            </span>
            <Seam fade />
          </div>
        </Tile>
        <Tile label="chips: hover to run the stitches, press to settle" data-specimen="chips-motion">
          <div className="w-[343px]">
            <Chips chips={CHIPS} disabled={false} onChip={noop} />
          </div>
        </Tile>
        <Tile label="chips, reduced motion" data-specimen="chips-reduced">
          <div data-reduced="true" className="w-[343px]">
            <Chips chips={CHIPS} disabled={false} onChip={noop} />
          </div>
        </Tile>
      </Section>
    </ReducedMotionOverride>
  );
}
