import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/demo (brief 054, R15.8)", () => {
  it("answers enabled true only for FRANKI_DEMO=on, with no-store and no other field", async () => {
    vi.stubEnv("FRANKI_DEMO", "on");
    const on = GET();
    expect(on.status).toBe(200);
    expect(on.headers.get("cache-control")).toBe("no-store");
    expect(await on.json()).toStrictEqual({ enabled: true });
    for (const value of ["", "On", "on ", "off", "true"]) {
      vi.stubEnv("FRANKI_DEMO", value);
      expect(await GET().json()).toStrictEqual({ enabled: false });
    }
    vi.stubEnv("FRANKI_DEMO", undefined as unknown as string);
    expect(await GET().json()).toStrictEqual({ enabled: false });
  });
});
