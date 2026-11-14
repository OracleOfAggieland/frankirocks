// Brief 049 property "Read-only": the scope list is exactly the four read-only scopes, and for any sequence of calls
// on the live Google port every request goes to one of the pinned endpoints with its pinned method: the data methods
// are GETs, and nothing can send, draft, label or change mail or events. Seed recorded in docs/briefs/049-report.md.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GOOGLE_TEST_ENV } from "../testing/fake-google";
import { googleConfig } from "./config";
import { AUTHORIZE_URL, GOOGLE_SCOPES, authorizationUrl } from "./oauth";
import { type GoogleFetch, GOOGLE_ENDPOINTS, googlePort } from "./port";

const ANSWERS: Record<string, unknown> = {
  "POST https://oauth2.googleapis.com/token": { access_token: "ya29.x", expires_in: 3599, scope: GOOGLE_SCOPES.join(" "), token_type: "Bearer" },
  "POST https://oauth2.googleapis.com/revoke": {},
  "GET https://gmail.googleapis.com/gmail/v1/users/me/messages": { messages: [{ id: "18c0ffee", threadId: "18c0ffee" }] },
  "GET https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}": { id: "18c0ffee", threadId: "18c0ffee", payload: { headers: [] } },
  "GET https://www.googleapis.com/calendar/v3/calendars/primary/events": { timeZone: "UTC", items: [] },
};

const METHODS = ["exchangeCode", "refresh", "revoke", "listMessages", "getMessage", "listEvents"] as const;

/** The endpoint a URL is, with a message ID replaced by `{id}`. */
function endpointOf(method: string, url: URL): string {
  const path = url.pathname.replace(/^(\/gmail\/v1\/users\/me\/messages)\/[^/]+$/, "$1/{id}");
  return `${method} ${url.origin}${path}`;
}

describe("property: the Google port is read-only (brief 049)", () => {
  it("1,000 runs", async () => {
    const config = googleConfig(GOOGLE_TEST_ENV);
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ method: fc.constantFrom(...METHODS), arg: fc.string({ maxLength: 40 }), n: fc.integer({ min: -5, max: 500 }) }), { minLength: 1, maxLength: 12 }),
        async (calls) => {
          const seen: { method: string; url: URL; body: string | undefined }[] = [];
          const fetchFn: GoogleFetch = async (url, init) => {
            const u = new URL(url);
            seen.push({ method: init.method, url: u, body: init.body });
            expect(init.redirect).toBe("error");
            return { ok: true, status: 200, json: async () => ANSWERS[endpointOf(init.method, u)] ?? {} };
          };
          const port = googlePort(fetchFn);
          expect(Object.keys(port).sort()).toEqual([...METHODS].sort());
          const all = [...calls, ...METHODS.map((method) => ({ method, arg: "18c0ffee", n: 10 }))];
          for (const c of all) {
            try {
              if (c.method === "exchangeCode") await port.exchangeCode(config, { code: c.arg, verifier: c.arg, redirectUri: "http://localhost:3000/google/callback" });
              else if (c.method === "refresh") await port.refresh(config, c.arg);
              else if (c.method === "revoke") await port.revoke(c.arg);
              else if (c.method === "listMessages") await port.listMessages(c.arg, c.arg, c.n);
              else if (c.method === "getMessage") await port.getMessage(c.arg, c.arg);
              else await port.listEvents(c.arg, { timeMin: "2026-11-13T00:00:00.000Z", timeMax: "2026-11-14T00:00:00.000Z", max: c.n });
            } catch {
              // A refused argument or an off-shape answer is a refusal, never a request elsewhere.
            }
          }
          for (const s of seen) {
            const ep = endpointOf(s.method, s.url);
            expect(GOOGLE_ENDPOINTS as readonly string[]).toContain(ep);
            if (s.method === "GET") expect(s.body).toBeUndefined();
            expect(s.url.username + s.url.password).toBe("");
          }
          expect(new Set(seen.map((s) => endpointOf(s.method, s.url)))).toEqual(new Set(GOOGLE_ENDPOINTS));
        },
      ),
      { numRuns: 1000 },
    );
    expect([...GOOGLE_SCOPES]).toEqual(["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.events.readonly"]);
    expect([...GOOGLE_ENDPOINTS].sort()).toEqual([
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages",
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}",
      "GET https://www.googleapis.com/calendar/v3/calendars/primary/events",
      "POST https://oauth2.googleapis.com/revoke",
      "POST https://oauth2.googleapis.com/token",
    ]);
    const url = new URL(authorizationUrl({ clientId: config.clientId, redirectUri: "http://localhost:3000/google/callback", state: "s".repeat(43), challenge: "c".repeat(43) }));
    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL);
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES.join(" "));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});
