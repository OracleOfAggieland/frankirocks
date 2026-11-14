// Brief 049 part B review fixes S1, S2, S9 and S10: the scopes Google may answer, the one redirect URI per
// deployment, an unreadable ID token after a good exchange, and the exact authorization URL.
import { describe, expect, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { ALL_SCOPES, GOOGLE_TEST_ENV, REFRESH_TOKEN, SIGN_IN_SCOPES } from "../testing/fake-google";
import { TEST_ENV, callRoute } from "../testing/fakes";
import { OWNER, connectGoogleVia, googleRig } from "../testing/google-rig";
import { googleConfig, googleConfigured } from "./config";
import { ACCEPTED_SCOPES, CALENDAR_SCOPE, GMAIL_SCOPE, GOOGLE_SCOPES, grantedOf } from "./oauth";
import { type GoogleFetch, googlePort } from "./port";
import { googleStartRoute } from "./routes";

const HOSTED = "https://franki-web--frankirocks.us-central1.hosted.app";

describe("S1: Google's answer may carry the sign-in's identity scopes", () => {
  it("treats openid, email, profile and their userinfo names as harmless extras", () => {
    expect(grantedOf(["openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile", GMAIL_SCOPE])).toEqual({ mail: true, calendar: false });
    expect(grantedOf(["profile", "https://www.googleapis.com/auth/userinfo.profile"])).toEqual({ mail: false, calendar: false });
  });

  it("connects when the answer also names the Franki sign-in's profile scopes, and revokes nothing", async () => {
    const { rig, google } = googleRig();
    await ensureCoreDocs(OWNER, rig.deps);
    google.tokens.scope = [...ALL_SCOPES, ...SIGN_IN_SCOPES];
    const res = await connectGoogleVia(rig);
    expect(res.status).toBe(200);
    expect(res.body.google).toMatchObject({ mail: "connected", calendar: "connected" });
    expect(google.count("revoke")).toBe(0);
  });

  it("any other unexpected scope still refuses and revokes", async () => {
    for (const extra of ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/drive.readonly"]) {
      const { rig, google } = googleRig();
      google.tokens.scope = [...ALL_SCOPES, ...SIGN_IN_SCOPES, extra];
      expect((await connectGoogleVia(rig)).status).toBe(409);
      expect(google.count("revoke")).toBe(1);
    }
  });
});

describe("S10: the scopes and the authorization URL are pinned", () => {
  it("the accepted set is exactly the two read-only scopes and five identity names", () => {
    expect([...ACCEPTED_SCOPES].sort()).toEqual(
      [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar.events.readonly",
      ].sort(),
    );
    for (const s of ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.compose", "https://mail.google.com/"]) {
      expect(ACCEPTED_SCOPES.has(s)).toBe(false);
      expect(grantedOf([s])).toBe("unexpected");
    }
  });

  it("start answers exactly these parameters, in this order", async () => {
    const { rig } = googleRig();
    const url = new URL((await callRoute(rig, googleStartRoute, {})).body.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect([...url.searchParams.keys()]).toEqual(["client_id", "redirect_uri", "response_type", "scope", "state", "access_type", "prompt", "include_granted_scopes", "code_challenge", "code_challenge_method"]);
    expect(url.searchParams.get("scope")).toBe(`openid email ${GMAIL_SCOPE} ${CALENDAR_SCOPE}`);
    expect(GOOGLE_SCOPES).toEqual(["openid", "email", GMAIL_SCOPE, CALENDAR_SCOPE]);
    expect(Object.fromEntries([...url.searchParams].filter(([k]) => k !== "state" && k !== "code_challenge"))).toEqual({
      client_id: GOOGLE_TEST_ENV.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: "http://localhost:3000/google/callback",
      response_type: "code",
      scope: `openid email ${GMAIL_SCOPE} ${CALENDAR_SCOPE}`,
      access_type: "offline",
      prompt: "consent",
      // G-296: review S1 ruled this out; it stays until the committed property's pin of it may change.
      include_granted_scopes: "true",
      code_challenge_method: "S256",
    });
  });
});

describe("S2: one configured redirect URI per deployment", () => {
  it("unset or malformed is not configured, and every route answers CONFIG", async () => {
    for (const value of [undefined, "", "https://evil.example/elsewhere", "javascript:alert(1)//google/callback"]) {
      const env: Record<string, string> = { ...TEST_ENV, ...GOOGLE_TEST_ENV };
      if (value === undefined) delete env.GOOGLE_OAUTH_REDIRECT_URI;
      else env.GOOGLE_OAUTH_REDIRECT_URI = value;
      const { rig, google } = googleRig(env);
      expect(googleConfigured(rig.deps.env)).toBe(false);
      const res = await callRoute(rig, googleStartRoute, {});
      expect(res).toMatchObject({ status: 500, body: { error: "CONFIG" } });
      expect(google.calls).toEqual([]);
    }
  });

  it("start refuses an allowed Origin that is not the configured one", async () => {
    const { rig } = googleRig({ ...TEST_ENV, ...GOOGLE_TEST_ENV, GOOGLE_OAUTH_REDIRECT_URI: `${HOSTED}/google/callback` });
    expect((await callRoute(rig, googleStartRoute, {}, { origin: "http://localhost:3000" })).status).toBe(403);
    const ok = await callRoute(rig, googleStartRoute, {}, { origin: HOSTED });
    expect(ok.status).toBe(200);
    expect(new URL(ok.body.url).searchParams.get("redirect_uri")).toBe(`${HOSTED}/google/callback`);
  });

  it("reads the value as given, trimmed", () => {
    expect(googleConfig({ ...GOOGLE_TEST_ENV, GOOGLE_OAUTH_REDIRECT_URI: ` ${HOSTED}/google/callback ` }).redirectUri).toBe(`${HOSTED}/google/callback`);
  });
});

describe("S9: an ID token the port can't read after a good exchange is revoked", () => {
  for (const [why, idToken] of [
    ["oversize", "a".repeat(9000)],
    ["not a string", 42],
  ] as const) {
    it(`${why}: the fresh tokens are revoked at Google, then the call fails`, async () => {
      const seen: string[] = [];
      const fetchFn: GoogleFetch = async (url, init) => {
        seen.push(`${init.method} ${url} ${init.body ?? ""}`);
        if (url.endsWith("/token")) return { ok: true, status: 200, json: async () => ({ access_token: "ya29.fresh", refresh_token: REFRESH_TOKEN, scope: `openid ${GMAIL_SCOPE}`, id_token: idToken }) };
        return { ok: true, status: 200, json: async () => ({}) };
      };
      const port = googlePort(fetchFn);
      await expect(port.exchangeCode(googleConfig(GOOGLE_TEST_ENV), { code: "4/x", verifier: "v".repeat(43), redirectUri: "http://localhost:3000/google/callback" })).rejects.toMatchObject({ problem: "unknown" });
      expect(seen).toHaveLength(2);
      expect(seen[1]).toBe(`POST https://oauth2.googleapis.com/revoke token=${encodeURIComponent(REFRESH_TOKEN)}`);
    });
  }

});
