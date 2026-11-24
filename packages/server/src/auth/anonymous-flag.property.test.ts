/**
 * The flag comes from the token (brief 054 design, correctness property 10; R4.1 to R4.5). 1,000 runs.
 *   FOR ALL verified claim sets (`firebase.sign_in_provider` any string or absent, or no `firebase` claim at all) and
 *   ALL request bodies, queries and headers, the `anonymous` the Route_Guard reports is true exactly when the provider
 *   is "anonymous", and it does not change when the body, query or other headers change.
 * The live verifier's mapping (`verifiedIdentity`) is the part under test; the Admin SDK's own check is not faked here.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { verifiedIdentity } from "./admin-verifier";
import { ALLOWED_ORIGINS, BODY_CAP_BYTES, type TokenVerifier, guardRequestFull } from "./guard";

const RUNS = { numRuns: 1000 };

const provider = fc.oneof(
  fc.constantFrom("anonymous", "Anonymous", "anonymous ", "password", "google.com", "custom", "phone", ""),
  fc.string({ maxLength: 16 }),
);
type Claims = { uid: string; firebase?: { sign_in_provider?: string } };
const claims: fc.Arbitrary<Claims> = fc.oneof(
  fc.record({ uid: fc.constantFrom("owner-1", "anon-7") }),
  fc.record({ uid: fc.constantFrom("owner-1", "anon-7"), firebase: fc.record({}) }),
  fc.record({ uid: fc.constantFrom("owner-1", "anon-7"), firebase: fc.record({ sign_in_provider: provider }) }),
);

/** Headers a browser or a forger might add. None of them is the bearer token. */
const extraHeaders = fc.dictionary(
  fc.constantFrom("x-franki-demo", "x-anonymous", "cookie", "x-forwarded-for", "user-agent", "x-sign-in-provider"),
  fc.constantFrom("anonymous", "true", "1", "on", "false", ""),
  { maxKeys: 4 },
);
const body = fc.oneof(
  fc.constant(""),
  fc.constantFrom('{"anonymous":true}', '{"anonymous":false}', '{"demo":"on"}', '{"firebase":{"sign_in_provider":"anonymous"}}'),
  fc.string({ maxLength: 40 }),
);

function verifierOf(c: Claims): TokenVerifier {
  return { verify: async () => verifiedIdentity(c) };
}

function guardFlag(c: Claims, method: "GET" | "POST", headers: Record<string, string>, bodyText: string): Promise<boolean> {
  const all = new Map<string, string>(Object.entries(headers));
  all.set("authorization", "Bearer some-verified-token");
  all.set("origin", ALLOWED_ORIGINS[0]!);
  return guardRequestFull(
    { method, header: (n) => all.get(n.toLowerCase()) ?? null, bodyText: method === "GET" ? "" : bodyText, bodyCap: BODY_CAP_BYTES },
    verifierOf(c),
    undefined,
    undefined,
    { demoOn: true },
  ).then((g) => g.anonymous);
}

describe("the anonymous flag", () => {
  it("is true exactly when the verified provider is anonymous, whatever else the request carries", async () => {
    await fc.assert(
      fc.asyncProperty(claims, fc.constantFrom("GET" as const, "POST" as const), extraHeaders, extraHeaders, body, body, async (c, method, h1, h2, b1, b2) => {
        const expected = c.firebase?.sign_in_provider === "anonymous";
        expect(verifiedIdentity(c)).toStrictEqual({ uid: c.uid, anonymous: expected });
        expect(await guardFlag(c, method, h1, b1)).toBe(expected);
        // Another body and other headers never move it.
        expect(await guardFlag(c, method, h2, b2)).toBe(expected);
      }),
      RUNS,
    );
  });
});
