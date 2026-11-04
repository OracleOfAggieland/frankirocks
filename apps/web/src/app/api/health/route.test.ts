import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("/api/health (R31.8): unchanged by this slice", () => {
  it("GET returns exactly ok, service, node and configured{openaiKey, smokeToken, brainModel, voiceModel}", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-not-a-key");
    vi.stubEnv("SMOKE_TOKEN", "");
    vi.stubEnv("FRANKI_BRAIN_MODEL", "test-brain-model");
    vi.stubEnv("FRANKI_VOICE_MODEL", "test-voice-model");
    const body = await GET().json();
    expect(Object.keys(body)).toEqual(["ok", "service", "node", "configured"]);
    expect(body).toEqual({
      ok: true,
      service: "franki-web",
      node: process.version,
      configured: { openaiKey: true, smokeToken: false, brainModel: "test-brain-model", voiceModel: "test-voice-model" },
    });
    // Values of secrets never appear, and attribution never goes into API responses.
    expect(JSON.stringify(body)).not.toContain("test-not-a-key");
    expect(JSON.stringify(body)).not.toMatch(/kiro/i);
  });

  it("GET reports null models when unset", async () => {
    vi.stubEnv("FRANKI_BRAIN_MODEL", undefined as unknown as string);
    vi.stubEnv("FRANKI_VOICE_MODEL", undefined as unknown as string);
    const body = await GET().json();
    expect(body.configured).toMatchObject({ brainModel: null, voiceModel: null });
  });

  it("POST refuses a request without a valid smoke token", async () => {
    vi.stubEnv("SMOKE_TOKEN", "the-smoke-token");
    const res = await POST(new Request("http://localhost:3000/api/health", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    const wrong = await POST(new Request("http://localhost:3000/api/health", { method: "POST", headers: { authorization: "Bearer nope" } }));
    expect(wrong.status).toBe(401);
  });
});
