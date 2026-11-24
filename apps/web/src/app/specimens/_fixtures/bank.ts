// Fixture banks for the bank sheet's specimens and tests (brief 046 part B). Made-up names; no amounts, as the
// screen never shows any.
import type { BankView } from "@franki/core";
import { type BankEvent, type BankState, INITIAL_BANK, bankStep } from "../../../ui/bank/bank-machine";

const ID_A = "bankAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ID_B = "bankBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

export const BANK_ZONE = "America/Chicago";

export const BANK_READ: BankView = {
  connectorId: ID_A,
  institutionName: "Hollow Creek Bank",
  state: "connected",
  importing: false,
  accounts: [
    { name: "Everyday checking", mask: "0417", type: "depository", subtype: "checking" },
    { name: "Rainy day savings", mask: "2290", type: "depository", subtype: "savings" },
  ],
  lastSyncedAt: "2026-11-13T20:05:00.000Z",
  coveredFrom: "2026-08-15T12:00:00.000Z",
  coveredTo: "2026-11-13T12:00:00.000Z",
  needsReconnect: false,
};

export const BANK_IMPORTING: BankView = { ...BANK_READ, state: "syncing", importing: true, lastSyncedAt: null, coveredFrom: null, coveredTo: null };

export const BANK_EXPIRED: BankView = {
  connectorId: ID_B,
  institutionName: "Lamplight Credit Union",
  state: "expired",
  importing: false,
  accounts: [{ name: "Card", mask: "8812", type: "credit", subtype: "credit card" }],
  lastSyncedAt: "2026-11-02T15:30:00.000Z",
  coveredFrom: "2026-08-04T12:00:00.000Z",
  coveredTo: "2026-11-02T12:00:00.000Z",
  needsReconnect: true,
};

export const BANK_DISCONNECTED: BankView = { ...BANK_READ, state: "disconnected", importing: false };

/** Brief 054: a demo visit's bank, as the simulated bank answers it. Made-up names. */
export const BANK_SIMULATED: BankView = {
  ...BANK_READ,
  connectorId: "bankDEMOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  institutionName: "Moonlit Trust of Kisses",
  accounts: [
    { name: "Everyday checking", mask: "0001", type: "depository", subtype: "checking" },
    { name: "Launch reserve", mask: "0002", type: "depository", subtype: "savings" },
  ],
};

/** The machine's state after `events`, from the start. */
export function bankAfter(events: BankEvent[], from: BankState = INITIAL_BANK): BankState {
  let s = from;
  for (const e of events) s = bankStep(s, e).state;
  return s;
}

const at = 1_000;

/** Opened, and the status answered `banks`. */
export function bankShowing(banks: BankView[], canConnect = true): BankState {
  return bankAfter([
    { kind: "opened", at },
    { kind: "statusAnswered", seq: 1, answer: { ok: true, banks, canConnect }, at },
  ]);
}

/** Brief 054: opened on a demo visit: the server answered one simulated bank, and no Connect. */
export function bankSimulated(): BankState {
  return bankAfter([
    { kind: "opened", at },
    { kind: "statusAnswered", seq: 1, answer: { ok: true, banks: [BANK_SIMULATED], canConnect: false, simulated: true }, at },
  ]);
}

/** Every phase of the sheet, and the notes worth seeing, for the specimens page. */
export function bankSpecimens(): { id: string; label: string; state: BankState }[] {
  const none = bankShowing([]);
  const read = bankShowing([BANK_READ]);
  return [
    { id: "reading", label: "reading", state: bankAfter([{ kind: "opened", at }]) },
    { id: "read-failed", label: "readFailed", state: bankAfter([{ kind: "opened", at }, { kind: "statusAnswered", seq: 1, answer: { ok: false }, at }]) },
    { id: "none", label: "idle: no bank yet", state: none },
    { id: "preparing", label: "preparing", state: bankAfter([{ kind: "connectPressed", at }], none) },
    { id: "linking", label: "linking", state: bankAfter([{ kind: "connectPressed", at }, { kind: "tokenAnswered", seq: 2, answer: { ok: true, linkToken: "link-specimen" }, at }], none) },
    {
      id: "link-closed",
      label: "idle: Link closed",
      state: bankAfter([{ kind: "connectPressed", at }, { kind: "tokenAnswered", seq: 2, answer: { ok: true, linkToken: "link-specimen" }, at }, { kind: "linkExit", session: 2, error: false, at }], none),
    },
    {
      id: "connecting",
      label: "connecting",
      state: bankAfter(
        [
          { kind: "connectPressed", at },
          { kind: "tokenAnswered", seq: 2, answer: { ok: true, linkToken: "link-specimen" }, at },
          { kind: "linkSuccess", session: 2, success: { publicToken: "public-specimen", institutionId: null, institutionName: null }, requestId: "r1", at },
        ],
        none,
      ),
    },
    { id: "importing", label: "idle: importing", state: { ...bankShowing([BANK_IMPORTING]), note: "connected" } },
    { id: "connected", label: "idle: connected and read", state: read },
    { id: "needs-reconnect", label: "idle: needs a new sign-in", state: bankShowing([BANK_READ, BANK_EXPIRED]) },
    { id: "confirming", label: "confirming", state: bankAfter([{ kind: "disconnectPressed", connectorId: BANK_READ.connectorId, at }], read) },
    {
      id: "disconnecting",
      label: "disconnecting",
      state: bankAfter([{ kind: "disconnectPressed", connectorId: BANK_READ.connectorId, at }, { kind: "disconnectYes", requestId: "r2", at }], read),
    },
    { id: "disconnected", label: "idle: disconnected", state: { ...none, note: "disconnected" } },
    { id: "limit", label: "idle: at the limit", state: bankShowing([BANK_READ, { ...BANK_READ, connectorId: "c2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }], false) },
    { id: "connect-refused", label: "idle: connect refused", state: { ...none, note: "connectRefused" } },
    { id: "simulated", label: "idle: simulated (demo visit)", state: bankSimulated() },
  ];
}
