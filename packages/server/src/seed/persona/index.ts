/**
 * The one seeded persona (brief 019 task 2): Riley, as spec §15's demo needs it. Every packet is authored by hand.
 */
import type { SeedFixture } from "../fixture";
import { BANK } from "./bank";
import { BULK } from "./bulk";
import { CALENDAR } from "./calendar";
import { MAIL } from "./mail";
import { TURNS } from "./turns";

/** The route's `fixtureId` for this persona: a fixed 43-character ID shape the browser can send. */
export const PERSONA_FIXTURE_ID = "seed-persona-riley-v1-000000000000000000000";

export const PERSONA: SeedFixture = {
  id: PERSONA_FIXTURE_ID,
  origin: "authored",
  windowDays: 21,
  lines: [...TURNS, ...MAIL, ...BULK, ...CALENDAR, ...BANK],
};

/** Fixtures by ID; the reset route refuses any other ID. */
export const FIXTURES: ReadonlyMap<string, SeedFixture> = new Map([[PERSONA.id, PERSONA]]);
