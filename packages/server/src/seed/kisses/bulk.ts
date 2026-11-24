/**
 * Jeffrey's 16 bulk emails: four invented senders, four issues each, spread over days -20 to -1. Bulk is
 * logistics-only (contracts §4 Gmail row): every packet here is empty. Subjects and body templates are copied
 * from the bible (`docs/briefs/054-persona-bible.md`).
 */
import type { MailLine } from "../fixture";

interface BulkSender {
  key: string;
  name: string;
  address: string;
  subjects: [string, string, string, string];
  body: (subject: string) => string;
}

const SENDERS: BulkSender[] = [
  {
    key: "pilcrow",
    name: "Pilcrow Corner Grocer",
    address: "weekly@pilcrow-grocer.example",
    subjects: ["This week's produce", "Soup season is here", "Fresh bread on Saturdays", "Pantry staples on sale"],
    body: (s) => `${s}. Pick up a flyer at the front counter. You're receiving this because you joined the Pilcrow Corner Grocer list.`,
  },
  {
    key: "altivane",
    name: "Altivane Rocket Fuel Depot",
    address: "news@altivane-fuel.example",
    subjects: ["Fuel prices this week", "New tank cleaning service", "Holiday delivery hours", "Thanks for fueling with us"],
    body: (s) => `${s}. Call the depot desk to schedule a delivery. You're on the Altivane Rocket Fuel Depot list.`,
  },
  {
    key: "wrenfield",
    name: "Wrenfield Public Library",
    address: "news@wrenfield-library.example",
    subjects: ["New books this month", "Story hour on Saturdays", "Quiet study rooms reopen", "Our used book sale"],
    body: (s) => `${s}. Ask at the front desk for details. Wrenfield Public Library is open every day but Monday.`,
  },
  {
    key: "tidewick",
    name: "Tidewick Film Club",
    address: "picks@tidewick-film.example",
    subjects: ["Films we think you'll like", "A new season of classics", "Members' night is back", "We saved you a seat"],
    body: (s) => `${s}. Your membership includes every film in the club. You're on the Tidewick Film Club list.`,
  },
];

/** Issue `i` of sender `s` lands on day -20 + (s * 2 + i * 5) % 20, at a fixed morning minute. */
function bulkLine(sender: BulkSender, s: number, i: number): MailLine {
  const subject = sender.subjects[i]!;
  const day = -20 + ((s * 2 + i * 5) % 20);
  const minute = 6 * 60 + ((s * 7 + i * 11) % 120);
  return {
    kind: "mail",
    id: `bulk-${sender.key}-${i + 1}`,
    at: { day, minute },
    bulk: true,
    fromSelf: false,
    from: { name: sender.name, address: sender.address },
    to: ["jeffrey@kisses.example"],
    subject,
    body: sender.body(subject),
    thread: `bulk-${sender.key}-${i + 1}`,
    claims: {},
  };
}

export const BULK: MailLine[] = SENDERS.flatMap((sender, s) => sender.subjects.map((_, i) => bulkLine(sender, s, i)));
