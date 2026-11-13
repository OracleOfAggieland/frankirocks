// The bank sheet's five calls (brief 046 part B): each route answer, mapped to what the bank machine needs.
import { BankStatusResponse, BankView, validate } from "@franki/core";
import { describe, expect, it } from "vitest";
import { BANK_DISCONNECTED, BANK_EXPIRED, BANK_IMPORTING, BANK_READ } from "../app/specimens/_fixtures/bank";
import {
  BANK_CONNECT_PATH,
  BANK_DISCONNECT_PATH,
  BANK_LINK_TOKEN_PATH,
  BANK_STATUS_PATH,
  BANK_SYNC_PATH,
  type FetchLike,
  connectBank,
  connectFields,
  createApiClient,
  disconnectBank,
  readBankStatus,
  requestBankLinkToken,
  syncBank,
} from "./api";

function fake(respond: () => Response | Promise<Response>) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, init });
    return respond();
  };
  return { api: createApiClient({ getToken: async () => "tok", fetch }), seen };
}
const offline = () => fake(() => Promise.reject(new Error("offline")));
const answer = (status: number, error: string) => () => Response.json({ error, retryAfterMs: 0 }, { status });

const REQ = "reqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CONNECT = { requestId: REQ, publicToken: "public-sandbox-1", institutionId: "ins_1", institutionName: "Hollow Creek Bank" };
const ID = BANK_READ.connectorId;

describe("bank fixtures", () => {
  it("are valid against the closed shapes", () => {
    for (const b of [BANK_READ, BANK_IMPORTING, BANK_EXPIRED, BANK_DISCONNECTED]) expect(validate(BankView, b).ok).toBe(true);
    expect(validate(BankStatusResponse, { banks: [BANK_READ], canConnect: true }).ok).toBe(true);
  });
});

describe("readBankStatus", () => {
  it("reads GET /api/bank/status and returns the banks and the server's word on the limit", async () => {
    const { api, seen } = fake(() => Response.json({ banks: [BANK_READ, BANK_EXPIRED], canConnect: false }));
    expect(await readBankStatus(api)).toEqual({ ok: true, banks: [BANK_READ, BANK_EXPIRED], canConnect: false });
    expect(seen[0]!.url).toBe(BANK_STATUS_PATH);
    expect(seen[0]!.init.method).toBe("GET");
  });

  it("is a failure for a body the contract refuses (a balance is never let through)", async () => {
    const { api } = fake(() => Response.json({ banks: [{ ...BANK_READ, balanceCents: 100 }], canConnect: true }));
    expect(await readBankStatus(api)).toEqual({ ok: false });
  });

  it("is a failure on an error status or no answer", async () => {
    expect(await readBankStatus(fake(answer(500, "INTERNAL")).api)).toEqual({ ok: false });
    expect(await readBankStatus(offline().api)).toEqual({ ok: false });
  });

  it("sends nothing while signed out", async () => {
    const seen: string[] = [];
    const api = createApiClient({ getToken: async () => null, fetch: async (u) => (seen.push(u), Response.json({})) });
    expect(await readBankStatus(api)).toEqual({ ok: false });
    expect(seen).toEqual([]);
  });
});

describe("requestBankLinkToken", () => {
  it("posts {} and returns the token", async () => {
    const { api, seen } = fake(() => Response.json({ linkToken: "link-production-1", expiresAt: "2026-11-13T23:00:00.000Z" }));
    expect(await requestBankLinkToken(api)).toEqual({ ok: true, linkToken: "link-production-1" });
    expect(seen[0]!.url).toBe(BANK_LINK_TOKEN_PATH);
    expect(seen[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({});
  });

  it("answers limit on 409 LIMIT", async () => {
    expect(await requestBankLinkToken(fake(answer(409, "LIMIT")).api)).toEqual({ ok: false, why: "limit" });
  });

  it("answers failed on a call in flight (429 LIMIT), a server failure, no answer or a malformed body", async () => {
    expect(await requestBankLinkToken(fake(answer(429, "LIMIT")).api)).toEqual({ ok: false, why: "failed" });
    expect(await requestBankLinkToken(fake(answer(503, "DEPENDENCY")).api)).toEqual({ ok: false, why: "failed" });
    expect(await requestBankLinkToken(fake(answer(500, "CONFIG")).api)).toEqual({ ok: false, why: "failed" });
    expect(await requestBankLinkToken(offline().api)).toEqual({ ok: false, why: "failed" });
    expect(await requestBankLinkToken(fake(() => Response.json({ linkToken: "" })).api)).toEqual({ ok: false, why: "failed" });
  });
});

describe("connectBank", () => {
  it("posts the closed request once and returns the bank", async () => {
    const { api, seen } = fake(() => Response.json({ bank: BANK_IMPORTING, existing: false }));
    expect(await connectBank(api, CONNECT)).toEqual({ ok: true, bank: BANK_IMPORTING, existing: false });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(BANK_CONNECT_PATH);
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual(CONNECT);
  });

  it("returns existing for the same bank twice", async () => {
    expect(await connectBank(fake(() => Response.json({ bank: BANK_READ, existing: true })).api, CONNECT)).toEqual({ ok: true, bank: BANK_READ, existing: true });
  });

  it("answers refused on 409 STALE and other refusals, and limit on 409 LIMIT", async () => {
    expect(await connectBank(fake(answer(409, "STALE")).api, CONNECT)).toEqual({ ok: false, why: "refused" });
    expect(await connectBank(fake(answer(400, "PARSE")).api, CONNECT)).toEqual({ ok: false, why: "refused" });
    expect(await connectBank(fake(answer(409, "LIMIT")).api, CONNECT)).toEqual({ ok: false, why: "limit" });
  });

  it("answers unknown with no answer, a call in flight or a server failure", async () => {
    expect(await connectBank(offline().api, CONNECT)).toEqual({ ok: false, why: "unknown" });
    expect(await connectBank(fake(answer(429, "LIMIT")).api, CONNECT)).toEqual({ ok: false, why: "unknown" });
    expect(await connectBank(fake(answer(503, "DEPENDENCY")).api, CONNECT)).toEqual({ ok: false, why: "unknown" });
    expect(await connectBank(fake(() => Response.json({ bank: { ...BANK_READ, accessToken: "x" }, existing: false })).api, CONNECT)).toEqual({ ok: false, why: "unknown" });
  });

  it("never sends a request the contract would refuse", async () => {
    const { api, seen } = fake(() => Response.json({}));
    expect(await connectBank(api, { ...CONNECT, publicToken: "" })).toEqual({ ok: false, why: "refused" });
    expect(seen).toEqual([]);
  });

  it("fits Link's institution fields to the closed request", () => {
    expect(connectFields("ins_1", "Hollow Creek Bank")).toEqual({ institutionId: "ins_1", institutionName: "Hollow Creek Bank" });
    expect(connectFields(undefined, null)).toEqual({ institutionId: null, institutionName: null });
    expect(connectFields("x".repeat(65), "y".repeat(129))).toEqual({ institutionId: null, institutionName: null });
    expect(connectFields("", "")).toEqual({ institutionId: null, institutionName: null });
  });
});

describe("syncBank", () => {
  it("posts {connectorId} and returns the bank after one pull", async () => {
    const { api, seen } = fake(() => Response.json({ bank: BANK_READ }));
    expect(await syncBank(api, { connectorId: ID })).toEqual({ ok: true, bank: BANK_READ });
    expect(seen[0]!.url).toBe(BANK_SYNC_PATH);
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ connectorId: ID });
  });

  it("is a failure on an error status, no answer or a malformed body", async () => {
    expect(await syncBank(fake(answer(503, "DEPENDENCY")).api, { connectorId: ID })).toEqual({ ok: false });
    expect(await syncBank(fake(answer(404, "SCOPE")).api, { connectorId: ID })).toEqual({ ok: false });
    expect(await syncBank(offline().api, { connectorId: ID })).toEqual({ ok: false });
    expect(await syncBank(fake(() => Response.json({})).api, { connectorId: ID })).toEqual({ ok: false });
  });
});

describe("disconnectBank", () => {
  it("posts {requestId, connectorId} and returns the disconnected bank", async () => {
    const { api, seen } = fake(() => Response.json({ bank: BANK_DISCONNECTED }));
    expect(await disconnectBank(api, { requestId: REQ, connectorId: ID })).toEqual({ ok: true, bank: BANK_DISCONNECTED });
    expect(seen[0]!.url).toBe(BANK_DISCONNECT_PATH);
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ requestId: REQ, connectorId: ID });
  });

  it("answers failed when the server said it did not disconnect", async () => {
    expect(await disconnectBank(fake(answer(503, "DEPENDENCY")).api, { requestId: REQ, connectorId: ID })).toEqual({ ok: false, why: "failed" });
    expect(await disconnectBank(fake(answer(404, "SCOPE")).api, { requestId: REQ, connectorId: ID })).toEqual({ ok: false, why: "failed" });
  });

  it("answers unknown with no answer, a call in flight or a malformed body", async () => {
    expect(await disconnectBank(offline().api, { requestId: REQ, connectorId: ID })).toEqual({ ok: false, why: "unknown" });
    expect(await disconnectBank(fake(answer(429, "LIMIT")).api, { requestId: REQ, connectorId: ID })).toEqual({ ok: false, why: "unknown" });
    expect(await disconnectBank(fake(() => Response.json({ bank: null })).api, { requestId: REQ, connectorId: ID })).toEqual({ ok: false, why: "unknown" });
  });
});
