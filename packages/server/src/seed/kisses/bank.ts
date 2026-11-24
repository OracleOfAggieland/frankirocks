/**
 * Jeffrey Kisses's bank rows, all invented merchants. Purchases are positive cents and deposits are negative.
 *
 * Hero arithmetic (TAKEOUT_LATE_V1 on the clone's Friday):
 * - Window: days -21 to -1, which is 21 local dates. Every one of the 21 dates has at least one bank row (21 of 21,
 *   at least 14 needed).
 * - Seven posted takeout orders, $186.00 in all: 3150 + 2875 + 3420 + 2640 + 3315 + 900 + 2300 = 18600 cents.
 * - Five are late, on the five nights with an accepted, confirmed, opaque, timed meeting at or after 18:00: days -18,
 *   -16, -11, -9 and -4. 3150 + 2875 + 3420 + 2640 + 3315 = 15400 cents ($154.00). Each is bought between 20:35 and
 *   21:15, so the unit is "nights".
 * - 5 of 7 by count (10 > 7) and $154.00 of $186.00 by cents (30800 > 18600): `mostly`.
 * - Not late: the $9.00 sandwich at lunch on day -13 (no late meeting that day), and the $23.00 burrito on day -2 (its
 *   18:45 meeting was declined; its only accepted meeting is at 17:00).
 * - No pending row inside the window. The one pending takeout row is on day -22. No takeout row on day 0 or later.
 * - Decoys that must not count: the pending order on day -22 (a late-meeting night outside the window), the
 *   restaurant dinner on day -17 (a late-meeting night), the groceries at 18:20 on day -1 (a late-meeting night), the
 *   declined 18:45 meeting and the accepted 17:00 meeting on day -2, and late meetings on nights with no takeout
 *   (days -17, -15, -10, -8, -1).
 *
 * The joke is the size of ordinary things: deposits of $41,250,000,000.00, $9,625,000,000.00 and $27,500,000,000.00,
 * fuel rows of $1,850,000.00 to $4,200,000.00, a $1,250,000.00 set of hangar doors, and a 35 cent library fee. Every
 * amount is under BANK_CENTS_MAX ($100 billion a row). The largest row is 4,125,000,000,000 cents.
 *
 * Rocket fuel: three Altivane Rocket Fuel Depot rows on days -6 to -1 and one on day 0 at 07:10 (before 08:40), so every
 * Friday of the year has at least one row in "this month". Only those rows carry TRANSPORTATION_GAS.
 */
import { type BankLine, at } from "../fixture";

const LAUNCH = "sim-acct-launch-0003";
const SAVINGS = "sim-acct-savings-0002";

/** A bank row on the first account (checking) unless `account` is given; `code` is left out for a category's default. */
const row = (
  id: string,
  day: number,
  hhmm: string,
  merchant: string,
  amountCents: number,
  category: BankLine["category"],
  extra: { code?: string; account?: string; pending?: boolean } = {},
): BankLine => ({
  kind: "bank",
  id,
  at: at(day, hhmm),
  merchant,
  amountCents,
  category,
  ...(extra.pending ? { pending: true } : {}),
  ...(extra.code !== undefined ? { code: extra.code } : {}),
  ...(extra.account !== undefined ? { account: extra.account } : {}),
});

export const BANK: BankLine[] = [
  // The pending decoy, on a late-meeting night outside the window.
  row("bank-takeout-pending", -22, "20:30", "Fennow Dumpling House", 2950, "takeout", { pending: true }),
  row("bank-deposit-1", -21, "09:00", "Orbital Dividend", -4125000000000, "other", { code: "INCOME_DIVIDENDS" }),
  row("bank-grocery-1", -21, "11:30", "Pilcrow Corner Grocer", 4815, "groceries"),
  row("bank-coffee-1", -20, "08:40", "Quillfeather Coffee", 450, "restaurant", { code: "FOOD_AND_DRINK_COFFEE" }),
  row("bank-fuel-1", -19, "10:20", "Altivane Rocket Fuel Depot", 185000000, "other", { code: "TRANSPORTATION_GAS", account: LAUNCH }),
  row("bank-flowers-1", -19, "10:45", "Mossleigh Florist", 4500, "other", { code: "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES" }),
  // Late takeout, night 1 of 5: 3150.
  row("bank-takeout-1", -18, "20:40", "Pellory Noodle Bar", 3150, "takeout"),
  row("bank-film-club", -17, "06:30", "Tidewick Film Club", 1199, "other", { code: "ENTERTAINMENT_TV_AND_MOVIES" }),
  // Decoy: a restaurant dinner on a late-meeting night.
  row("bank-restaurant", -17, "20:15", "Corvessa Bistro", 8400, "restaurant"),
  // Late takeout, night 2 of 5: 2875.
  row("bank-takeout-2", -16, "21:05", "Fennow Dumpling House", 2875, "takeout"),
  row("bank-hangar-doors", -15, "10:00", "Greyling Hangar Doors", 125000000, "other", { code: "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE", account: LAUNCH }),
  row("bank-grocery-2", -15, "18:40", "Pilcrow Corner Grocer", 2260, "groceries"),
  row("bank-puzzle-club", -14, "06:30", "Pellucid Puzzle Monthly", 499, "other", { code: "ENTERTAINMENT_OTHER_ENTERTAINMENT" }),
  row("bank-coffee-2", -14, "08:35", "Quillfeather Coffee", 450, "restaurant", { code: "FOOD_AND_DRINK_COFFEE" }),
  row("bank-deposit-2", -13, "09:00", "Lunar Freight Royalties", -962500000000, "other", { code: "INCOME_OTHER_INCOME", account: SAVINGS }),
  // Not late: a sandwich at lunch, 900.
  row("bank-takeout-6", -13, "12:40", "Corner Sandwich Shop", 900, "takeout"),
  row("bank-fuel-2", -12, "10:05", "Altivane Rocket Fuel Depot", 237500000, "other", { code: "TRANSPORTATION_GAS", account: LAUNCH }),
  row("bank-flowers-2", -12, "10:40", "Mossleigh Florist", 4500, "other", { code: "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES" }),
  // Late takeout, night 3 of 5: 3420.
  row("bank-takeout-3", -11, "20:50", "Pellory Noodle Bar", 3420, "takeout"),
  row("bank-grocery-3", -10, "17:40", "Pilcrow Corner Grocer", 5130, "groceries"),
  // Late takeout, night 4 of 5: 2640.
  row("bank-takeout-4", -9, "21:15", "Brindlewick Burrito Window", 2640, "takeout"),
  row("bank-crossword-club", -8, "06:30", "Cobble Crossword Club", 299, "other", { code: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS" }),
  row("bank-coffee-3", -8, "08:30", "Quillfeather Coffee", 450, "restaurant", { code: "FOOD_AND_DRINK_COFFEE" }),
  row("bank-deposit-3", -7, "09:00", "Orbital Dividend", -2750000000000, "other", { code: "INCOME_DIVIDENDS" }),
  row("bank-grocery-4", -7, "12:10", "Pilcrow Corner Grocer", 3940, "groceries"),
  row("bank-fuel-3", -6, "09:40", "Altivane Rocket Fuel Depot", 420000000, "other", { code: "TRANSPORTATION_GAS", account: LAUNCH }),
  // Next to the fuel: a 35 cent library fee.
  row("bank-library-fee", -6, "11:15", "Wrenfield Public Library", 35, "other", { code: "GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT" }),
  row("bank-flowers-3", -5, "10:40", "Mossleigh Florist", 4500, "other", { code: "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES" }),
  // Late takeout, night 5 of 5: 3315.
  row("bank-takeout-5", -4, "20:35", "Fennow Dumpling House", 3315, "takeout"),
  row("bank-coffee-4", -3, "08:20", "Quillfeather Coffee", 450, "restaurant", { code: "FOOD_AND_DRINK_COFFEE" }),
  row("bank-fuel-4", -3, "14:10", "Altivane Rocket Fuel Depot", 312000000, "other", { code: "TRANSPORTATION_GAS", account: LAUNCH }),
  // Not late: the 18:45 meeting was declined and the accepted one is at 17:00. 2300.
  row("bank-takeout-7", -2, "19:50", "Brindlewick Burrito Window", 2300, "takeout"),
  row("bank-fuel-5", -1, "16:30", "Altivane Rocket Fuel Depot", 296000000, "other", { code: "TRANSPORTATION_GAS", account: LAUNCH }),
  // Decoy: groceries at 18:20 on a late-meeting night.
  row("bank-grocery-5", -1, "18:20", "Pilcrow Corner Grocer", 2775, "groceries"),
  // Today, before 08:40.
  row("bank-fuel-6", 0, "07:10", "Altivane Rocket Fuel Depot", 148000000, "other", { code: "TRANSPORTATION_GAS", account: LAUNCH }),
];
