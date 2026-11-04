import { describe, expect, it } from "vitest";
import { parseWith, runRoute, type RouteSpec } from "../routes/runtime";
import { fakeRequest, testRig } from "../testing/fakes";
import { obj, str } from "@franki/core";
import { SDP_BODY_CAP_BYTES, type TokenVerifier } from "./guard";

/** A route that records whether its logic ran and which uid it saw. */
function probe(bodyCap?: number) {
  const seen: string[] = [];
  const spec: RouteSpec<{ note: string }> = {
    name: "probe",
    ...(bodyCap === undefined ? {} : { bodyCap }),
    parse: ({ body }) => parseWith(obj({ note: str(200_000) }), body ?? { note: "" }),
    run: async (ctx) => {
      seen.push(ctx.uid);
      return { ok: true };
    },
  };
  return { spec, seen };
}

/** A verifier that always throws `failure`. */
function failingVerifier(failure: unknown): TokenVerifier {
  return {
    async verify() {
      throw failure;
    },
  };
}

describe("Route_Guard", () => {
  describe("401 AUTH", () => {
    it.each([
      ["no Authorization header", { token: null }],
      ["an invalid token", { token: "garbage" }],
      ["a revoked token", { token: "revoked:owner-1" }],
    ])("rejects %s and runs no route logic", async (_label, init) => {
      const rig = testRig();
      const { spec, seen } = probe();
      const res = await runRoute(spec, fakeRequest({ ...init, body: { note: "x" } }), rig.deps, rig.sched.schedule);
      expect(res).toEqual({ status: 401, body: { error: "AUTH", retryAfterMs: 0 } });
      expect(seen).toEqual([]);
    });

    it.each([
      ["an expired token", "auth/id-token-expired"],
      ["a revoked token", "auth/id-token-revoked"],
      ["a malformed token", "auth/argument-error"],
      ["a token that is not a Firebase ID token", "auth/invalid-id-token"],
    ])("answers AUTH for %s from the verifier", async (_label, code) => {
      const rig = testRig();
      const deps = { ...rig.deps, tokens: failingVerifier(Object.assign(new Error("SECRET-TOKEN-TEXT"), { code })) };
      const { spec, seen } = probe();
      const res = await runRoute(spec, fakeRequest({ body: { note: "x" } }), deps, rig.sched.schedule);
      expect(res).toEqual({ status: 401, body: { error: "AUTH", retryAfterMs: 0 } });
      expect(seen).toEqual([]);
    });

    it("rejects a non-Bearer scheme", async () => {
      const rig = testRig();
      const { spec, seen } = probe();
      const req = fakeRequest({ token: null, body: { note: "x" } });
      const withBasic = { ...req, header: (n: string) => (n === "authorization" ? "Basic token:owner-1" : req.header(n)) };
      expect((await runRoute(spec, withBasic, rig.deps, rig.sched.schedule)).status).toBe(401);
      expect(seen).toEqual([]);
    });
  });

  describe("503 DEPENDENCY (verifier infrastructure failures)", () => {
    it.each([
      ["auth/internal-error", Object.assign(new Error("An internal error has occurred."), { code: "auth/internal-error" })],
      ["a plain thrown Error", new Error("connect ECONNRESET")],
      ["an unknown auth code", Object.assign(new Error("x"), { code: "auth/something-new" })],
      ["a non-Error throw", "boom"],
    ])("answers DEPENDENCY with a retry hint for %s, and logs only the code", async (_label, failure) => {
      const rig = testRig();
      const deps = { ...rig.deps, tokens: failingVerifier(failure) };
      const { spec, seen } = probe();
      const res = await runRoute(spec, fakeRequest({ token: "token:owner-1", body: { note: "x" } }), deps, rig.sched.schedule);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "DEPENDENCY", retryAfterMs: 1000 });
      expect(seen).toEqual([]);
      const line = rig.logs.find((l) => l.event === "auth.verifier");
      expect(line).toBeDefined();
      const text = JSON.stringify(rig.logs);
      expect(text).not.toContain("token:owner-1");
      expect(text).not.toContain("ECONNRESET");
      if (failure instanceof Error && (failure as { code?: string }).code === "auth/internal-error") {
        expect(line?.fields).toEqual({ code: "auth/internal-error" });
      }
    });
  });

  describe("403 AUTH (origin and CSRF)", () => {
    it.each([
      ["a missing Origin", null],
      ["an unknown Origin", "https://evil.example"],
      ["an Origin that only starts with an allowed one", "http://localhost:3000.evil.example"],
      ["a different port", "http://localhost:3001"],
    ])("rejects %s on POST", async (_label, origin) => {
      const rig = testRig();
      const { spec, seen } = probe();
      const res = await runRoute(spec, fakeRequest({ origin, body: { note: "x" } }), rig.deps, rig.sched.schedule);
      expect(res).toEqual({ status: 403, body: { error: "AUTH", retryAfterMs: 0 } });
      expect(seen).toEqual([]);
    });

    it("accepts the deployed origin", async () => {
      const rig = testRig();
      const { spec } = probe();
      const res = await runRoute(
        spec,
        fakeRequest({ origin: "https://franki-web--frankirocks.us-central1.hosted.app", body: { note: "x" } }),
        rig.deps,
        rig.sched.schedule,
      );
      expect(res.status).toBe(200);
    });

    it("does not require Origin on GET", async () => {
      const rig = testRig();
      const { spec } = probe();
      expect((await runRoute(spec, fakeRequest({ method: "GET", origin: null }), rig.deps, rig.sched.schedule)).status).toBe(200);
    });
  });

  describe("413 LIMIT", () => {
    it("rejects a body over 128 KiB", async () => {
      const rig = testRig();
      const { spec, seen } = probe();
      const res = await runRoute(spec, fakeRequest({ body: { note: "a".repeat(131_072) } }), rig.deps, rig.sched.schedule);
      expect(res).toEqual({ status: 413, body: { error: "LIMIT", retryAfterMs: 0 } });
      expect(seen).toEqual([]);
    });

    it("counts UTF-8 bytes, not characters", async () => {
      const rig = testRig();
      const { spec } = probe();
      // 50,000 three-byte characters are 150,000 bytes.
      const res = await runRoute(spec, fakeRequest({ body: { note: "€".repeat(50_000) } }), rig.deps, rig.sched.schedule);
      expect(res.status).toBe(413);
    });

    it("allows up to 256 KiB on the SDP cap and rejects past it", async () => {
      const rig = testRig();
      const { spec } = probe(SDP_BODY_CAP_BYTES);
      expect((await runRoute(spec, fakeRequest({ body: { note: "a".repeat(140_000) } }), rig.deps, rig.sched.schedule)).status).toBe(200);
      expect((await runRoute(spec, fakeRequest({ body: { note: "a".repeat(262_144) } }), rig.deps, rig.sched.schedule)).status).toBe(413);
    });
  });

  it("passes only the token's uid as the tenant (R10.5)", async () => {
    const rig = testRig();
    const { spec, seen } = probe();
    await runRoute(spec, fakeRequest({ token: "token:owner-2", body: { note: "x" } }), rig.deps, rig.sched.schedule);
    expect(seen).toEqual(["owner-2"]);
  });

  it("returns PARSE for a body that is not JSON", async () => {
    const rig = testRig();
    const { spec, seen } = probe();
    const res = await runRoute(spec, fakeRequest({ rawBody: "{nope" }), rig.deps, rig.sched.schedule);
    expect(res).toEqual({ status: 400, body: { error: "PARSE", retryAfterMs: 0 } });
    expect(seen).toEqual([]);
  });
});
