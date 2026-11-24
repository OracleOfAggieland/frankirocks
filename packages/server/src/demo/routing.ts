/**
 * The routing ports (brief 054, R10). Tokens route, flags do not: each call carrying a token goes to the simulator
 * when the token reads as a simulator token, to the live provider when it carries no marker, and to neither when it
 * carries the marker and does not parse (a definite refusal, never forwarded). Nothing else is read: no body, query,
 * browser value or stored flag can send a call to a simulator (R10.10).
 *
 * The calls that carry no token (`linkToken`, `exchange`, `exchangeCode`) go to the live port. A demo visit never
 * reaches them: the routes refuse it first (R14.3, R14.4).
 *
 * Composed in `bank/routes.ts` and `google/routes.ts` only. A `deps.bank` or `deps.google` override replaces the whole
 * port, routing included, so tests that script a port are unchanged.
 */
import { BankCallError, type BankPort } from "../bank/plaid";
import { GoogleCallError, type GooglePort } from "../google/port";
import { simulatedBank } from "./sim-bank";
import { simulatedGoogle } from "./sim-google";
import { readSimToken } from "./token";

/** Which side one token belongs to. */
function sideOf(token: string): "live" | "sim" | "malformed" {
  const t = readSimToken(token);
  return t === null ? "live" : t === "malformed" ? "malformed" : "sim";
}

/** A bank port that sends each call by its access token. */
export function routingBank(live: BankPort, sim: BankPort = simulatedBank()): BankPort {
  const pick = (token: string): BankPort => {
    const side = sideOf(token);
    if (side === "malformed") throw new BankCallError(null, true);
    return side === "sim" ? sim : live;
  };
  return {
    linkToken: (config, clientUserId) => live.linkToken(config, clientUserId),
    exchange: (config, publicToken) => live.exchange(config, publicToken),
    accounts: async (config, accessToken) => pick(accessToken).accounts(config, accessToken),
    sync: async (config, accessToken, cursor) => pick(accessToken).sync(config, accessToken, cursor),
    remove: async (config, accessToken) => pick(accessToken).remove(config, accessToken),
  };
}

/** A Google port that sends each call by its refresh or access token. */
export function routingGoogle(live: GooglePort, sim: GooglePort = simulatedGoogle()): GooglePort {
  const pick = (token: string): GooglePort => {
    const side = sideOf(token);
    if (side === "malformed") throw new GoogleCallError("refused", true);
    return side === "sim" ? sim : live;
  };
  return {
    exchangeCode: (config, x) => live.exchangeCode(config, x),
    refresh: async (config, refreshToken) => pick(refreshToken).refresh(config, refreshToken),
    revoke: async (token) => pick(token).revoke(token),
    listMessages: async (accessToken, q, max) => pick(accessToken).listMessages(accessToken, q, max),
    getMessage: async (accessToken, id) => pick(accessToken).getMessage(accessToken, id),
    listEvents: async (accessToken, x) => pick(accessToken).listEvents(accessToken, x),
  };
}

const bankRefuses = async (): Promise<never> => {
  throw new BankCallError(null, true);
};
const googleRefuses = async (): Promise<never> => {
  throw new GoogleCallError("refused", true);
};

/** The live half of a demo-only deployment (no Plaid settings): every method refuses, so placeholders reach nothing. */
export const refusingBank: BankPort = { linkToken: bankRefuses, exchange: bankRefuses, accounts: bankRefuses, sync: bankRefuses, remove: bankRefuses };

/** The live half of a demo-only deployment (no Google settings): every method refuses. */
export const refusingGoogle: GooglePort = {
  exchangeCode: googleRefuses,
  refresh: googleRefuses,
  revoke: googleRefuses,
  listMessages: googleRefuses,
  getMessage: googleRefuses,
  listEvents: googleRefuses,
};
