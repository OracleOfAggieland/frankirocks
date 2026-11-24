/**
 * The demo persona (brief 054): Jeffrey Kisses, the second seeded fixture, played by a visitor who presses
 * Kiroween Demo. Its `demo` profile is what pairs it with an anonymous tenant and what the simulated bank and Google
 * answer from.
 *
 * The persona's own lines live in `turns.ts`, `mail.ts`, `bulk.ts`, `calendar.ts` and `bank.ts`, and its profile in
 * `profile.ts`, as `seed/persona/` is laid out. The plan they all follow is `docs/briefs/054-persona-bible.md`.
 *
 * This folder imports only `../fixture`, so it never forms a cycle with `seed/persona/`, which registers it.
 */
import type { SeedFixture } from "../fixture";
import { BANK } from "./bank";
import { BULK } from "./bulk";
import { CALENDAR } from "./calendar";
import { MAIL } from "./mail";
import { PROFILE } from "./profile";
import { TURNS } from "./turns";

/** The route's `fixtureId` for this persona: a fixed 43-character ID shape the browser can send (23 + 20). */
export const KISSES_FIXTURE_ID = "seed-persona-kisses-v1-00000000000000000000";

export const KISSES: SeedFixture = {
  id: KISSES_FIXTURE_ID,
  origin: "authored",
  windowDays: 21,
  lines: [...TURNS, ...MAIL, ...BULK, ...CALENDAR, ...BANK],
  demo: PROFILE,
};
