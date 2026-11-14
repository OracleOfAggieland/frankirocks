"use client";
// Brief 049 part A: what the screen shows of a background errand, drawn from fixture state. Nothing here calls a
// route: the running word as the stage shows it, and an errand's card as the Card_Dock shows it (each line with its
// source: sender, subject and date for mail; title and time for an event; no links).
import type { Card as WireCard } from "@franki/core";
import { ErrandWord } from "../../../components/errands/ErrandWord";
import { Card } from "../../../components/surfaces/Card";
import { type ShownErrands, errandCardProps, errandWord } from "../../../ui/errands/errand-view";
import { Section, Tile } from "./Section";

const card: WireCard = {
  id: "specimen-errand-card",
  kind: "source",
  title: "From your mail",
  lines: ["From Pat Plumber, yesterday: The plumber comes Thursday at 9.", "Pat Plumber · Your visit · Thu, Nov 12"],
  sources: [],
  sens: "S0",
};

const shown = (running: ShownErrands["running"], cards: WireCard[] = []): ShownErrands => ({ sessionId: "specimen", generation: 1, running, cards });

export function ErrandSection() {
  return (
    <Section id="errands" title="Errands">
      <Tile label="checking the mail" data-specimen="errands" data-errand-tile="running-mail">
        <div className="relative h-16">
          <ErrandWord text={errandWord(shown(["mail"]))} />
        </div>
      </Tile>
      <Tile label="checking mail and calendar" data-specimen="errands" data-errand-tile="running-both">
        <div className="relative h-16">
          <ErrandWord text={errandWord(shown(["mail", "calendar"]))} />
        </div>
      </Tile>
      <Tile label="the result's card" data-specimen="errands" data-errand-tile="card">
        {errandCardProps(shown([], [card])).map((c) => (
          <Card key={c.id} {...c} />
        ))}
      </Tile>
    </Section>
  );
}
