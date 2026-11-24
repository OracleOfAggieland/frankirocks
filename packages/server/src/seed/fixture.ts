/**
 * The seed fixture's shape (brief 019 tasks 2 and 3). A fixture is a list of lines; each line is one owner turn,
 * one email, one calendar event (with its revisions) or one bank row, and carries its own packet: the reader output
 * for that line alone. Packets here are written by hand (`origin: "authored"`), never model output.
 *
 * Times are relative: `day` counts local days from the clone's Friday (0 is that Friday, -3 the Tuesday before) and
 * `minute` is the local minute of that day. They become instants in the visitor's zone at load.
 *
 * A span is authored as its quote (and which occurrence, when the quote repeats). The build turns it into offsets
 * against the line's text; the load then checks every span exactly, so a quote that is not in the line fails it.
 */
import type { BankCategory, CLAIM_TYPES, LOGISTICS_TYPES, Topic } from "@franki/core";

export interface RelTime {
  day: number;
  minute: number;
}

/** `hh:mm` local, as a minute of the day. */
export const at = (day: number, hhmm: string): RelTime => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return { day, minute: h * 60 + m };
};

export type SpanField = "text" | "subject" | "body";

export interface AuthoredSpan {
  field: SpanField;
  quote: string;
  /** Which occurrence of the quote, from 0. */
  nth?: number;
}

export const q = (quote: string, field: SpanField = "text", nth = 0): AuthoredSpan => ({ field, quote, nth });

export interface AuthoredMention {
  localId: string;
  type: "person" | "pet" | "place" | "organization" | "artifact" | "occasion" | "topic";
  observedName: string;
  span: AuthoredSpan;
}

/** One ExtractV1 Item, with the fields a hand-written packet needs; the rest take the contract's empty values. */
export interface AuthoredItem {
  act: "statement" | "intention" | "promise_mine" | "soft_pref";
  kind: string;
  predicate: string;
  subject: string;
  scope?: string | null;
  value: Record<string, unknown>;
  args: Record<string, unknown>;
  mentions?: AuthoredMention[];
  /** Words said for a time; code resolves them against when the line was said. */
  when?: { spoken: string; appliesTo: "occurrence" | "due" | "valid_from" };
  spans: AuthoredSpan[];
  sens?: "S0" | "S1" | "S2";
  gravity?: number;
  flow?: "open" | "never_outbound";
}

/** One PrivateReadOwnV1 hypothesis: a guess from the owner's own words, proposed only. */
export interface AuthoredGuess {
  topic: Topic;
  claim: string;
  support: AuthoredSpan[];
  counter?: AuthoredSpan[];
}

export interface TurnLine {
  kind: "turn";
  id: string;
  at: RelTime;
  text: string;
  /** The ExtractV1 packet's Items. */
  extract: AuthoredItem[];
  /** The PrivateReadOwnV1 packet's hypotheses, when this line has one. */
  privateRead?: AuthoredGuess[];
}

export interface AuthoredSignal {
  topic: Topic;
  subjectName: string | null;
  spans: AuthoredSpan[];
}

export interface AuthoredClaims {
  logistics?: {
    type: (typeof LOGISTICS_TYPES)[number];
    spoken?: string;
    where?: string;
    participants?: string[];
    spans: AuthoredSpan[];
  }[];
  senderPromises?: { object: string; beneficiary?: string; spoken?: string; spans: AuthoredSpan[] }[];
  claimsAboutUser?: { type: (typeof CLAIM_TYPES)[number]; claim: string; spoken?: string; spans: AuthoredSpan[] }[];
  topicSignals?: AuthoredSignal[];
  directiveCount?: number;
}

export interface MailLine {
  kind: "mail";
  id: string;
  at: RelTime;
  bulk: boolean;
  /** True when the owner sent it. Own mail carries no ClaimsV1 packet: ClaimsV1 reads T only (contracts §5). */
  fromSelf: boolean;
  from: { name: string; address: string };
  to: string[];
  subject: string;
  body: string;
  /** Thread name; the thread key is salted from it. */
  thread: string;
  /** The line ID of the message this one replies to. */
  inReplyTo?: string;
  /** The ClaimsV1 packet (inbound mail only). */
  claims?: AuthoredClaims;
  /** The PrivateReadInboundV1 packet's topic signals, when this line has one. */
  inbound?: AuthoredSignal[];
  /** Brief 054: Gmail's DMARC verdict for the From domain. Omitted reads as "pass", as every seeded message does today. */
  dmarc?: "pass" | "fail" | "none";
  /** Brief 054, inbound mail only: carries Gmail's UNREAD label in the simulator. Omitted: read. */
  unread?: boolean;
}

export interface CalendarRevision {
  /** When this revision was known (assertedAt). */
  at: RelTime;
  start: RelTime;
  minutes: number;
  status: "confirmed" | "tentative" | "cancelled";
  selfResponse: "accepted" | "tentative" | "declined" | "needsAction" | "none";
  transparency?: "opaque" | "transparent";
}

/** A calendar event. Code reads it (spec §4 table), so its packet is the typed Observation built from these fields. */
export interface CalendarLine {
  kind: "calendar";
  id: string;
  title: string;
  organizerSelf: boolean;
  /** Oldest first; each is one Evidence revision of the same logical event. */
  revisions: CalendarRevision[];
}

/** A bank row. Code reads it, so its packet is the typed Observation. */
export interface BankLine {
  kind: "bank";
  id: string;
  /** The purchase instant the provider authorized. */
  at: RelTime;
  merchant: string;
  amountCents: number;
  category: BankCategory;
  pending?: boolean;
  /**
   * Brief 054: Plaid's detailed category code, which `read_money`'s groups read when the simulator serves the line.
   * Omitted: `bankCodeOf` takes the category's default. When present it must map back to `category`.
   */
  code?: string;
  /** Brief 054: an `accountId` of the fixture's `demo.bank.accounts`. Omitted: the first account. */
  account?: string;
}

export type SeedLine = TurnLine | MailLine | CalendarLine | BankLine;

/** Brief 054: one simulated bank account of a demo fixture, as the simulator answers it. */
export interface DemoAccount {
  /** The provider-style account ID the simulator answers. 1 to 128 characters, unique in the profile. */
  accountId: string;
  /** At most 128 characters. */
  name: string;
  /** At most 8 characters. */
  mask: string | null;
  /** At most 32 characters, for example "depository". */
  type: string;
  /** At most 64 characters. */
  subtype: string | null;
}

/** Brief 054: what marks a fixture as a demo fixture: the persona the visitor plays, and the simulated accounts behind it. */
export interface DemoProfile {
  /** The name the account menu shows. Pinned to the browser's `DEMO_NAME` by `scripts/kisses-fixture-id.test.ts`. */
  displayName: string;
  bank: {
    /** 1 to 128 characters, stored as `BankConnection.itemId`. */
    itemId: string;
    /** At most 64 characters. */
    institutionId: string;
    /** At most 128 characters, and unchanged by `safeName`. */
    institutionName: string;
    /** 1 to `BANK_ACCOUNTS_MAX` (32). */
    accounts: DemoAccount[];
  };
  google: {
    /** The persona's invented address: the connector's `email`, and the From of his own sent mail. */
    email: string;
  };
}

export interface SeedFixture {
  /** The route's fixtureId: a 43-character ID shape. */
  id: string;
  /** `authored`: packets written by hand. `regenerated`: packets from `regenerate.ts`, which the load refuses for now. */
  origin: "authored" | "regenerated";
  /** The hero window: this many local dates, ending the day before the clone's Friday. */
  windowDays: number;
  lines: SeedLine[];
  /** Brief 054: present only on a demo fixture. Its presence is what pairs the fixture with an anonymous tenant (R5). */
  demo?: DemoProfile;
}

/** Brief 054: the default detailed code of a category, as the simulator answers it; "other" has none. */
export const DEFAULT_BANK_CODE: Readonly<Record<BankCategory, string | null>> = {
  takeout: "FOOD_AND_DRINK_FAST_FOOD",
  groceries: "FOOD_AND_DRINK_GROCERIES",
  restaurant: "FOOD_AND_DRINK_RESTAURANT",
  other: null,
};

/** The detailed code the simulator answers for a bank line: its own, else its category's default. */
export const bankCodeOf = (l: BankLine): string | null => l.code ?? DEFAULT_BANK_CODE[l.category];

/** The stored `senderAuth` of a mail line, from its `dmarc`: pass (or omitted) is "aligned", fail is "failed", none is "unknown". */
export const senderAuthOfLine = (l: MailLine): "aligned" | "failed" | "unknown" => (l.dmarc === "fail" ? "failed" : l.dmarc === "none" ? "unknown" : "aligned");
