import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type HealthDeps, type Heartbeat, redactSecrets, runDeepHealth } from "./health";

const NOW = Date.parse("2026-10-30T18:00:00Z");
const config = { brainModel: "gpt-6.1-terra", voiceModel: "gpt-realtime-2.1" };
const secretLike = fc.stringMatching(/^(?:sk-proj-|sk-|ek_)[A-Za-z0-9_-]{16,64}$/);

function fakeDeps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  const beat: Heartbeat = { atMs: NOW - 60_000, openaiOk: true, kmsOk: true };
  return {
    now: () => NOW,
    firestoreRoundTrip: async () => true,
    retrieveModel: async (model) => model,
    mintRealtimeClientSecret: async () => "ek_fake_client_secret_value",
    readHeartbeat: async () => beat,
    ...overrides,
  };
}

describe("runDeepHealth", () => {
  it("passes when every dependency is healthy", async () => {
    const report = await runDeepHealth(fakeDeps(), config);
    expect(report.ok).toBe(true);
    expect(Object.values(report.checks).every((check) => check.ok)).toBe(true);
  });

  it("fails overall when any single check fails", async () => {
    const broken: Partial<HealthDeps>[] = [
      { firestoreRoundTrip: async () => false },
      { retrieveModel: async () => "some-other-model" },
      { mintRealtimeClientSecret: async () => "not-a-client-secret" },
      { readHeartbeat: async () => null },
      { readHeartbeat: async () => ({ atMs: NOW - 2 * 60 * 60 * 1000, openaiOk: true, kmsOk: true }) },
      { readHeartbeat: async () => ({ atMs: NOW, openaiOk: true, kmsOk: false }) },
    ];
    for (const overrides of broken) {
      expect((await runDeepHealth(fakeDeps(overrides), config)).ok).toBe(false);
    }
  });

  it("never puts a minted client secret in the report", async () => {
    await fc.assert(
      fc.asyncProperty(secretLike, async (secret) => {
        const report = await runDeepHealth(fakeDeps({ mintRealtimeClientSecret: async () => secret }), config);
        expect(JSON.stringify(report)).not.toContain(secret);
      }),
    );
  });

  it("never leaks a key or secret that shows up in an error message", async () => {
    await fc.assert(
      fc.asyncProperty(secretLike, fc.string(), fc.string(), async (secret, before, after) => {
        const leak = async (): Promise<never> => {
          throw new Error(`${before} ${secret} ${after}`);
        };
        const report = await runDeepHealth(
          fakeDeps({ firestoreRoundTrip: leak, retrieveModel: leak, mintRealtimeClientSecret: leak, readHeartbeat: leak }),
          config,
        );
        expect(report.ok).toBe(false);
        expect(JSON.stringify(report)).not.toContain(secret);
      }),
    );
  });
});

describe("redactSecrets", () => {
  it("leaves ordinary text alone", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z ]{0,40}$/), (text) => {
        expect(redactSecrets(text)).toBe(text);
      }),
    );
  });
});
