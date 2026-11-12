/**
 * Riley's bank rows, all invented merchants. The hero fixture (spec §10): six posted takeout purchases of $30, $28,
 * $34, $34, $24 and $36, which is $186; the first four ($126) on nights with an accepted, timed, busy meeting at or
 * after 18:00, each bought after 20:30. Decoys that must not count: a pending takeout order on a late-meeting
 * night, and a restaurant dinner on another. Rows fall on 18 of the window's 21 dates.
 */
import { type BankLine, at } from "../fixture";

const row = (id: string, day: number, hhmm: string, merchant: string, amountCents: number, category: BankLine["category"], pending = false): BankLine => ({
  kind: "bank",
  id,
  at: at(day, hhmm),
  merchant,
  amountCents,
  category,
  ...(pending ? { pending } : {}),
});

export const BANK: BankLine[] = [
  // Takeout on the four late-meeting nights: 3000 + 2800 + 3400 + 3400 = 12600.
  row("bank-takeout-1", -17, "20:40", "Quillan Thai Kitchen", 3000, "takeout"),
  row("bank-takeout-2", -15, "20:55", "Marrowfield Pizza", 2800, "takeout"),
  row("bank-takeout-3", -10, "21:10", "Pellwick Noodles", 3400, "takeout"),
  row("bank-takeout-4", -8, "20:30", "Quillan Thai Kitchen", 3400, "takeout"),
  // Takeout on other nights: a Sunday with no meeting, and the night the 18:30 meeting was declined.
  row("bank-takeout-5", -12, "19:15", "Pellwick Noodles", 2400, "takeout"),
  row("bank-takeout-6", -3, "19:40", "Marrowfield Pizza", 3600, "takeout"),
  // Decoys.
  // The pending order sits the night before the window: a pending row inside a window makes the hero partial
  // (design note 022), so the decoy sits where it can only be mistaken, never counted (brief 023, S-171). Brief 030:
  // not at 00:20 today, which the window reaches once the world clock passes midnight (brief 036 finding 7); a window
  // only slides forward, so none from the clone's Friday on can reach day -22.
  row("bank-takeout-pending", -22, "00:20", "Quillan Thai Kitchen", 1900, "takeout", true),
  row("bank-restaurant", -16, "20:00", "Harrow & Vine Bistro", 5200, "restaurant"),
  // Groceries.
  row("bank-grocery-1", -21, "11:00", "Fennimore Market", 6420, "groceries"),
  row("bank-grocery-2", -19, "18:10", "Fennimore Market", 2315, "groceries"),
  row("bank-grocery-3", -14, "17:30", "Fennimore Market", 4880, "groceries"),
  row("bank-grocery-4", -11, "18:20", "Fennimore Market", 1975, "groceries"),
  row("bank-grocery-5", -7, "12:15", "Fennimore Market", 5310, "groceries"),
  row("bank-grocery-6", -4, "18:40", "Fennimore Market", 2760, "groceries"),
  row("bank-grocery-7", -2, "17:55", "Fennimore Market", 1840, "groceries"),
  // Everything else.
  row("bank-coffee-1", -18, "08:25", "Kettlewick Coffee", 475, "other"),
  row("bank-coffee-2", -9, "08:15", "Kettlewick Coffee", 475, "other"),
  row("bank-transit", -16, "07:40", "Ridgeline Transit", 250, "other"),
  row("bank-bike", -15, "12:00", "Spoke & Tread Cycles", 4500, "other"),
  row("bank-books", -5, "15:30", "Paperleaf Bookshop", 1899, "other"),
];
