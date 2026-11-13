/** Brief 046 part C: helpers for the money read's tests. A turn record as the read checks it, and a direct read. */
import { MONEY_GROUPS, MONEY_PERIODS, type MoneyArgs, type Turn } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { type MoneyReadOut, readMoney } from "../bank/money-read";
import { ensureCoreDocs } from "../core-docs";
import { OWNER } from "./bank-rig";
import type { TestRig } from "./fakes";
import { settle } from "./fakes";

/** The owner's own committed, final typed turn, as the read checks it. */
export function ownerTurnRecord(text: string): Turn {
  return { role: "user", sourceClass: "U", final: true, parseState: "committed", text, itemIds: [], judge: "typed" } as unknown as Turn;
}

export const arbMoneyArgs: fc.Arbitrary<MoneyArgs> = fc.record({
  period: fc.constantFrom(...MONEY_PERIODS),
  group: fc.option(fc.constantFrom(...MONEY_GROUPS), { nil: null }),
  merchant: fc.option(fc.constantFrom("Corner Cafe", "Burger Barn", "AMZN", "Green Grocer"), { nil: null }),
});

export const MONEY_WORDS = ["What did I spend last month?", "How much money went to Corner Cafe and Burger Barn?", "Show my purchases at AMZN", "spending at green grocer"] as const;

/** The read on virtual time, for the owner, with the tool route's budget. */
export async function readFor(rig: TestRig, text: string, args: MoneyArgs): Promise<MoneyReadOut> {
  await ensureCoreDocs(OWNER, rig.deps);
  const ctx = { uid: OWNER, deps: rig.deps, schedule: rig.sched.schedule };
  const now = rig.clock.read().opsClock.now;
  const work = readMoney(ctx, { turn: ownerTurnRecord(text), args, generation: 1, deadlineAt: now + 4_200, noteId: (n) => testId(`money-note-${n}`) as never });
  return (await settle(work, rig.clock, rig.timers)).value;
}
