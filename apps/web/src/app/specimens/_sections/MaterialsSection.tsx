// The five materials and the four shared parts (brief 015, UI direction "Materials"), each on its own tile.
import { FigLabel } from "../../../components/lab/FigLabel";
import { Lamp } from "../../../components/lab/Lamp";
import { Plate } from "../../../components/lab/Plate";
import { Rivet } from "../../../components/lab/Rivet";
import { Section, Tile } from "./Section";

const SWATCH = "flex h-24 w-40 items-center justify-center rounded-card text-sm";

export function MaterialsSection() {
  return (
    <>
      <Section id="materials" title="Materials">
        <Tile label="mat-blueprint" data-specimen="material" data-material="blueprint">
          <svg viewBox="0 0 160 96" width="160" height="96" aria-hidden="true" className="mat-blueprint">
            <rect x="8" y="8" width="144" height="80" rx="6" />
            <line x1="80" y1="4" x2="80" y2="92" strokeDasharray="4 3" />
            <circle cx="80" cy="48" r="22" />
          </svg>
        </Tile>
        <Tile label="mat-blueprint-box" data-specimen="material" data-material="blueprint-box">
          <div className={`${SWATCH} mat-blueprint-box`} />
        </Tile>
        <Tile label="mat-glass" data-specimen="material" data-material="glass">
          <div className={`${SWATCH} mat-glass text-ink`}>Something to read</div>
        </Tile>
        <Tile label="mat-brass" data-specimen="material" data-material="brass">
          <div className={`${SWATCH} mat-brass rounded-control font-medium`}>Something to touch</div>
        </Tile>
        <Tile label="mat-paper" data-specimen="material" data-material="paper">
          <div className={`${SWATCH} mat-paper font-mono`}>A printed record</div>
        </Tile>
        <Tile label="mat-gold" data-specimen="material" data-material="gold">
          <div className={`${SWATCH} mat-gold font-medium`}>A win</div>
        </Tile>
      </Section>
      <Section id="parts" title="Parts">
        <Tile label="Rivet" data-specimen="part" data-part-name="rivet">
          <div className="mat-glass flex h-16 w-40 items-start justify-between rounded-card p-2">
            <Rivet />
            <Rivet />
          </div>
        </Tile>
        <Tile label="Plate, brass and gold" data-specimen="part" data-part-name="plate">
          <div className="flex gap-2">
            <Plate>The Lab</Plate>
            <Plate tone="gold">$115 less</Plate>
          </div>
        </Tile>
        <Tile label="Lamp, off and on" data-specimen="part" data-part-name="lamp">
          <div className="flex gap-4">
            <Lamp on={false} />
            <Lamp on />
          </div>
        </Tile>
        <Tile label="Fig label, leader left and right" data-specimen="part" data-part-name="fig">
          <div className="flex flex-col gap-2">
            <FigLabel n="1">It&apos;s alive!</FigLabel>
            <FigLabel n="2" side="right">
              The bench
            </FigLabel>
          </div>
        </Tile>
      </Section>
    </>
  );
}
