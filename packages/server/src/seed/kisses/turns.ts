/**
 * Jeffrey's own turns over the three weeks before the clone's Friday, each with its hand-written ExtractV1 packet
 * (20 Items in all, over 16 turns). Invented names only. One allergy (peanuts), in his own words, written as a
 * `fact` labelled "allergy" because the seed cannot write a hard rule. No privateRead on any turn.
 */
import { type AuthoredItem, type AuthoredMention, type TurnLine, at, q } from "../fixture";

const fact = (topic: string, text: string, spans: AuthoredItem["spans"], label: string | null = null, sens?: "S1"): AuthoredItem => ({
  act: "statement",
  kind: "fact",
  predicate: "fact",
  subject: "self",
  value: { kind: "text", text },
  args: { topic, label },
  spans,
  ...(sens === undefined ? {} : { sens }),
});

const mention = (localId: string, type: AuthoredMention["type"], observedName: string, nth = 0): AuthoredMention => ({
  localId,
  type,
  observedName,
  span: q(observedName, "text", nth),
});

const relation = (code: string, name: string, quote: string, label: string | null = null): AuthoredItem => ({
  act: "statement",
  kind: "fact",
  predicate: "person.relation",
  subject: "self",
  value: { kind: "enum", code },
  args: { otherRef: "p", label, employerRef: null },
  mentions: [mention("p", "person", name)],
  spans: [q(quote)],
});

export const TURNS: TurnLine[] = [
  {
    kind: "turn",
    id: "turn-intro",
    at: at(-21, "19:05"),
    text: "I'm Jeffrey Kisses, by the way. I run Kisses Launch Works, a small rocket company in a very large hangar.",
    extract: [
      { act: "statement", kind: "fact", predicate: "identity.name", subject: "self", value: { kind: "text", text: "Jeffrey Kisses" }, args: {}, spans: [q("I'm Jeffrey Kisses")] },
      {
        act: "statement",
        kind: "fact",
        predicate: "employment.role",
        subject: "self",
        value: { kind: "text", text: "the founder of a small rocket company" },
        args: { employerRef: "klw", managerRef: null },
        mentions: [mention("klw", "organization", "Kisses Launch Works")],
        spans: [q("I run Kisses Launch Works, a small rocket company")],
      },
    ],
  },
  {
    kind: "turn",
    id: "turn-allergy",
    at: at(-21, "19:08"),
    text: "One thing that matters: I'm allergic to peanuts. Please keep them out of anything you suggest.",
    extract: [fact("food", "allergic to peanuts", [q("I'm allergic to peanuts")], "allergy", "S1")],
  },
  {
    kind: "turn",
    id: "turn-mornings",
    at: at(-20, "08:50"),
    text: "Mornings, keep it short. Launch status first, then everything else.",
    extract: [
      {
        act: "soft_pref",
        kind: "preference",
        predicate: "preference.style",
        subject: "self",
        value: { kind: "enum", code: "concise" },
        args: { context: "morning", dimension: "detail" },
        spans: [q("Mornings, keep it short")],
      },
    ],
  },
  {
    kind: "turn",
    id: "turn-tobias",
    at: at(-20, "17:30"),
    text: "Tobias Ambrey is my oldest friend. We play chess most Saturdays, and he usually wins.",
    extract: [
      relation("friend", "Tobias Ambrey", "Tobias Ambrey is my oldest friend", "oldest friend"),
      fact("relationship", "plays chess with Tobias most Saturdays", [q("We play chess most Saturdays")], "chess"),
    ],
  },
  {
    kind: "turn",
    id: "turn-mother",
    at: at(-19, "11:40"),
    text: "I call my mother Rosalind every Sunday at eleven. She always asks if I've eaten a real dinner.",
    extract: [
      relation("parent", "Rosalind", "my mother Rosalind", "mother"),
      fact("relationship", "calls his mother every Sunday at eleven", [q("I call my mother Rosalind every Sunday at eleven")], "Sunday call"),
    ],
  },
  {
    kind: "turn",
    id: "turn-mission-control",
    at: at(-16, "08:45"),
    text: "Mission Control is the crew at the hangar. They email me whenever the launch window moves, and it always moves to dinner.",
    extract: [fact("work", "Mission Control emails whenever the launch window moves", [q("They email me whenever the launch window moves")], "mission control")],
  },
  {
    kind: "turn",
    id: "turn-dumplings",
    at: at(-16, "21:30"),
    text: "Dumplings are my favorite dinner. Fennow Dumpling House is the one I always order from.",
    extract: [
      {
        act: "soft_pref",
        kind: "preference",
        predicate: "preference.food",
        subject: "self",
        value: { kind: "enum", code: "like" },
        args: { dimension: "dish", targetRef: "dumplings" },
        mentions: [mention("dumplings", "topic", "Dumplings")],
        spans: [q("Dumplings are my favorite dinner")],
      },
      {
        act: "statement",
        kind: "fact",
        predicate: "fact",
        subject: "self",
        value: { kind: "entity", mention: "fennow" },
        args: { topic: "food", label: "usual takeout place" },
        mentions: [mention("fennow", "place", "Fennow Dumpling House")],
        spans: [q("Fennow Dumpling House is the one I always order from")],
      },
    ],
  },
  {
    kind: "turn",
    id: "turn-olives",
    at: at(-15, "19:00"),
    text: "I don't like olives. I pick them off every time.",
    extract: [
      {
        act: "soft_pref",
        kind: "preference",
        predicate: "preference.food",
        subject: "self",
        value: { kind: "enum", code: "dislike" },
        args: { dimension: "ingredient", targetRef: "olives" },
        mentions: [mention("olives", "topic", "olives")],
        spans: [q("I don't like olives")],
      },
    ],
  },
  {
    kind: "turn",
    id: "turn-subscriptions",
    at: at(-14, "07:00"),
    text: "I forget to cancel subscriptions. I'm still paying for a puzzle club, a crossword club and a film club.",
    extract: [
      fact(
        "money",
        "forgets to cancel subscriptions and still pays for a puzzle club, a crossword club and a film club",
        [q("I forget to cancel subscriptions"), q("I'm still paying for a puzzle club, a crossword club and a film club")],
        "subscriptions",
      ),
    ],
  },
  {
    kind: "turn",
    id: "turn-checking",
    at: at(-13, "09:20"),
    text: "I keep about forty billion in checking. I try not to look at it, it makes the sandwiches feel silly.",
    extract: [fact("money", "keeps about forty billion in checking", [q("I keep about forty billion in checking")], "checking", "S1")],
  },
  {
    kind: "turn",
    id: "turn-tips",
    at: at(-12, "12:15"),
    text: "I always tip well. My mother taught me that, and she still checks.",
    extract: [fact("money", "always tips well", [q("I always tip well")], "tipping")],
  },
  {
    kind: "turn",
    id: "turn-dinner-goal",
    at: at(-11, "21:40"),
    text: "Another late review tonight. I'd like to stop ordering dinner on meeting nights and learn to cook something.",
    extract: [
      {
        act: "intention",
        kind: "goal",
        predicate: "goal",
        subject: "self",
        value: { kind: "text", text: "stop ordering dinner on meeting nights and learn to cook" },
        args: { domain: "food" },
        spans: [q("I'd like to stop ordering dinner on meeting nights and learn to cook something")],
      },
    ],
  },
  {
    kind: "turn",
    id: "turn-moon-garden",
    at: at(-10, "20:30"),
    text: "I want to grow a small garden on the moon by next spring. Tomatoes first.",
    extract: [
      {
        act: "intention",
        kind: "goal",
        predicate: "goal",
        subject: "self",
        value: { kind: "text", text: "grow a small garden on the moon by next spring" },
        args: { domain: "work" },
        spans: [q("I want to grow a small garden on the moon by next spring")],
      },
    ],
  },
  {
    kind: "turn",
    id: "turn-save-goal",
    at: at(-9, "21:45"),
    text: "I want to save a little on dinner. Not for the money, for the principle.",
    extract: [
      {
        act: "intention",
        kind: "goal",
        predicate: "goal",
        subject: "self",
        value: { kind: "text", text: "save a little on dinner, for the principle" },
        args: { domain: "money" },
        spans: [q("I want to save a little on dinner"), q("for the principle")],
      },
    ],
  },
  {
    kind: "turn",
    id: "turn-countdown",
    at: at(-8, "21:00"),
    text: "Last month the countdown rehearsal ran so late I ate dinner on a crate next to tank three.",
    extract: [
      {
        act: "statement",
        kind: "episode",
        predicate: "episode",
        subject: "self",
        value: { kind: "text", text: "ate dinner on a crate next to tank three when a countdown rehearsal ran late" },
        args: { occasionRef: null, eventRef: null },
        spans: [q("Last month the countdown rehearsal ran so late I ate dinner on a crate next to tank three")],
      },
    ],
  },
  {
    kind: "turn",
    id: "turn-library",
    at: at(-6, "11:30"),
    text: "I always return my library books a week late. The fee is thirty-five cents and I pay it gladly.",
    extract: [fact("other", "returns library books a week late and pays the fee gladly", [q("I always return my library books a week late")], "library books")],
  },
];
