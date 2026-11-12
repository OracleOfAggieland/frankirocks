/**
 * Riley's 60 bulk emails: ten invented senders, six issues each, spread over the three weeks. Bulk is
 * logistics-only (contracts §4 Gmail row): its ClaimsV1 packets carry logistics or nothing.
 */
import { type MailLine, at, q } from "../fixture";

interface BulkSender {
  key: string;
  name: string;
  address: string;
  subjects: [string, string, string, string, string, string];
  body: (subject: string) => string;
  /** A logistics line quoted from the body, for the issues that carry one. */
  logistics?: { type: "delivery" | "reschedule" | "cancellation" | "deadline"; quote: string; spoken: string };
}

const SENDERS: BulkSender[] = [
  {
    key: "fennimore",
    name: "Fennimore Market",
    address: "weekly@fennimore-market.example",
    subjects: ["This week's produce picks", "Soup season is here", "Five dinners under 30 minutes", "Our bakery's new rye", "Stock up on pantry staples", "Weekend tasting at the deli counter"],
    body: (s) => `${s}. Browse this week's flyer online or in store. You're receiving this because you joined the Fennimore Market list.`,
  },
  {
    key: "quillan",
    name: "Quillan Thai Kitchen",
    address: "rewards@quillan-thai.example",
    subjects: ["You earned a reward", "New: khao soi is back", "Lunch specials all week", "Double points Tuesday", "Our chef's curry flight", "Thanks for ordering with us"],
    body: (s) => `${s}. Show this email at pickup. Quillan Thai Kitchen rewards members only.`,
  },
  {
    key: "ridgeline",
    name: "Ridgeline Transit",
    address: "alerts@ridgeline-transit.example",
    subjects: ["Service change on the 14 line", "Weekend track work", "Holiday schedule posted", "Fare card reminder", "Elevator outage at Harbor station", "Service change on the 9 line"],
    body: (s) => `${s}. Buses replace trains between Harbor and Ashgrove this weekend. Plan extra time for your trip.`,
    logistics: { type: "reschedule", quote: "Buses replace trains between Harbor and Ashgrove this weekend", spoken: "this weekend" },
  },
  {
    key: "corvel-digest",
    name: "Corvel Freight Weekly",
    address: "news@corvel-freight.example",
    subjects: ["All-hands recap", "Safety week starts Monday", "New dock doors in Bay 3", "Meet the night dispatch team", "Quarterly numbers are in", "Volunteer day sign-ups"],
    body: (s) => `${s}. Read the full story on the staff portal. This digest goes to every Corvel Freight employee.`,
  },
  {
    key: "neighbors",
    name: "Ashgrove Neighbors List",
    address: "list@ashgrove-neighbors.example",
    subjects: ["Lost cat on Elm Row", "Street fair volunteers wanted", "Free couch, must pick up", "Leaf collection dates", "Book swap at the library", "Porch light tour"],
    body: (s) => `${s}. Reply to the list to respond. Ashgrove Neighbors is run by volunteers.`,
  },
  {
    key: "paperleaf",
    name: "Paperleaf Bookshop",
    address: "hello@paperleaf-books.example",
    subjects: ["Staff picks for November", "Author night next Thursday", "Your order has shipped", "Gift cards for the holidays", "New in history", "Our used-book sale"],
    body: (s) => `${s}. Your order is on its way and should arrive in 3 to 5 days. Thanks for shopping small.`,
    logistics: { type: "delivery", quote: "Your order is on its way and should arrive in 3 to 5 days", spoken: "in 3 to 5 days" },
  },
  {
    key: "running-club",
    name: "Gullwing Running Club",
    address: "club@gullwing-running.example",
    subjects: ["Tuesday track session", "Long run route for Saturday", "Hydration tips", "Race-week checklist", "Club social after the run", "Training plan, week 6"],
    body: (s) => `${s}. See the club page for routes and times. Runners of every pace welcome.`,
  },
  {
    key: "podcast",
    name: "Tideline Stories",
    address: "newsletter@tideline-stories.example",
    subjects: ["Episode 88: the first container ship", "Episode 89: lighthouse keepers", "Episode 90: canal mania", "Episode 91: the tea clippers", "Episode 92: harbor pilots", "Listener mail special"],
    body: (s) => `${s}. New episodes every week about the history of shipping. Listen wherever you get podcasts.`,
  },
  {
    key: "spoke",
    name: "Spoke & Tread Cycles",
    address: "deals@spoke-and-tread.example",
    subjects: ["Winter tires are in", "Free safety check this month", "Lights for darker evenings", "Members save on tubes", "Commuter bag sale", "Clinic: fix a flat"],
    body: (s) => `${s}. Visit the shop or browse online. You're on the Spoke & Tread list.`,
  },
  {
    key: "credit-union",
    name: "Tallow Creek Credit Union",
    address: "news@tallow-creek-cu.example",
    subjects: ["Branch hours for the holiday", "Protect yourself from scams", "Our new mobile app", "Savings goals made simple", "Member appreciation day", "Annual meeting notice"],
    body: (s) => `${s}. Learn more in online banking. Tallow Creek Credit Union is member owned.`,
  },
];

/** Issue `i` of sender `s` lands on day -20 + (s * 2 + i * 3) % 20, at a fixed morning minute. */
function bulkLine(sender: BulkSender, s: number, i: number): MailLine {
  const subject = sender.subjects[i]!;
  const day = -20 + ((s * 2 + i * 3) % 20);
  const minute = 6 * 60 + ((s * 7 + i * 11) % 120);
  const withLogistics = sender.logistics !== undefined && i % 2 === 0;
  return {
    kind: "mail",
    id: `bulk-${sender.key}-${i + 1}`,
    at: { day, minute },
    bulk: true,
    fromSelf: false,
    from: { name: sender.name, address: sender.address },
    to: ["riley@corvel-freight.example"],
    subject,
    body: sender.body(subject),
    thread: `bulk-${sender.key}-${i + 1}`,
    claims: withLogistics
      ? { logistics: [{ type: sender.logistics!.type, spoken: sender.logistics!.spoken, participants: [], spans: [q(sender.logistics!.quote, "body")] }] }
      : {},
  };
}

export const BULK: MailLine[] = SENDERS.flatMap((sender, s) => sender.subjects.map((_, i) => bulkLine(sender, s, i)));
