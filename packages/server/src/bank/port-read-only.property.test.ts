// Brief 046 property "Read-only": for any sequence of calls on the live port, every request goes to one of exactly five
// Plaid paths, none of which can move money, and a link token asks for exactly ["transactions"]. Seed recorded in
// brief 046's Outcome.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bankConfig } from "./config";
import { type FetchLike, PLAID_PATHS, PLAID_PRODUCTS, plaidPort } from "./plaid";
import { BANK_ENV } from "../testing/fake-bank";

const ANSWERS: Record<string, unknown> = {
  "/link/token/create": { link_token: "link-sandbox-x", expiration: "2026-11-03T16:00:00Z", request_id: "r" },
  "/item/public_token/exchange": { access_token: "access-sandbox-x", item_id: "item-x", request_id: "r" },
  "/accounts/get": { accounts: [], item: { item_id: "item-x", institution_id: null }, request_id: "r" },
  "/transactions/sync": { added: [], modified: [], removed: [], accounts: [], next_cursor: "c", has_more: false, transactions_update_status: "NOT_READY", request_id: "r" },
  "/item/remove": { request_id: "r" },
};

const METHODS = ["linkToken", "exchange", "accounts", "sync", "remove"] as const;

describe("property: the bank port is read-only (brief 046)", () => {
  it("1,000 runs", async () => {
    const config = { ...bankConfig(BANK_ENV), environment: "production" as const };
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ method: fc.constantFrom(...METHODS), arg: fc.string({ maxLength: 40 }), cursor: fc.option(fc.string({ maxLength: 20 }), { nil: null }) }), { minLength: 1, maxLength: 12 }),
        async (calls) => {
          const seen: { url: URL; body: Record<string, unknown> }[] = [];
          const fetchFn: FetchLike = async (url, init) => {
            const u = new URL(url);
            seen.push({ url: u, body: JSON.parse(init.body) as Record<string, unknown> });
            expect(init.method).toBe("POST");
            expect(init.redirect).toBe("error");
            return { ok: true, status: 200, json: async () => ANSWERS[u.pathname] ?? {} };
          };
          const port = plaidPort(fetchFn);
          expect(Object.keys(port).sort()).toEqual([...METHODS].sort());
          for (const c of [...calls, ...METHODS.map((method) => ({ method, arg: "x", cursor: null }))]) {
            if (c.method === "sync") await port.sync(config, c.arg, c.cursor);
            else if (c.method === "linkToken") await port.linkToken(config, c.arg);
            else await port[c.method](config, c.arg);
          }
          for (const s of seen) {
            expect(s.url.origin).toBe("https://production.plaid.com");
            expect(PLAID_PATHS as readonly string[]).toContain(s.url.pathname);
            expect(s.url.search).toBe("");
          }
          expect(new Set(seen.map((s) => s.url.pathname))).toEqual(new Set(PLAID_PATHS));
          for (const s of seen.filter((x) => x.url.pathname === "/link/token/create")) {
            expect(s.body.products).toEqual(["transactions"]);
            for (const k of Object.keys(s.body)) expect(k.includes("product") ? k : "products").toBe("products");
            expect(s.body.webhook).toBeUndefined();
            expect(s.body.redirect_uri).toBeUndefined();
          }
        },
      ),
      { numRuns: 1000 },
    );
    expect([...PLAID_PRODUCTS]).toEqual(["transactions"]);
    expect([...PLAID_PATHS].sort()).toEqual(["/accounts/get", "/item/public_token/exchange", "/item/remove", "/link/token/create", "/transactions/sync"]);
  });
});
