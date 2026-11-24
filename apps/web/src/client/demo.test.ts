// The switch's read in the browser (brief 054, R1.3, R15.8): only the closed `{ enabled: true }` shows the button.
import { describe, expect, it } from "vitest";
import { DEMO_HASH, DEMO_HREF, DEMO_PATH, demoAnswerEnabled, fetchDemoEnabled, hasDemoMarker } from "./demo";

const answer = (status: number, body: unknown) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the demo switch's read", () => {
  it("is true only for exactly { enabled: true }", async () => {
    expect(await fetchDemoEnabled(answer(200, { enabled: true }))).toBe(true);
    expect(await fetchDemoEnabled(answer(200, { enabled: false }))).toBe(false);
    expect(await fetchDemoEnabled(answer(200, { enabled: "true" }))).toBe(false);
    expect(await fetchDemoEnabled(answer(200, { enabled: true, extra: 1 }))).toBe(false);
    expect(await fetchDemoEnabled(answer(200, [true]))).toBe(false);
    expect(await fetchDemoEnabled(answer(200, null))).toBe(false);
    expect(await fetchDemoEnabled(answer(200, "not json"))).toBe(false);
    expect(await fetchDemoEnabled(answer(500, { enabled: true }))).toBe(false);
    expect(await fetchDemoEnabled(answer(404, { enabled: true }))).toBe(false);
  });

  it("is false when the request fails", async () => {
    expect(
      await fetchDemoEnabled(async () => {
        throw new TypeError("offline");
      }),
    ).toBe(false);
  });

  it("asks the one route with GET, no cache and no credentials", async () => {
    const seen: { input: string; init: RequestInit }[] = [];
    await fetchDemoEnabled(async (input, init) => {
      seen.push({ input, init });
      return new Response(JSON.stringify({ enabled: true }));
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.input).toBe(DEMO_PATH);
    expect(seen[0]!.init.method).toBe("GET");
    expect(seen[0]!.init.cache).toBe("no-store");
    expect(seen[0]!.init.credentials).toBe("omit");
  });

  it("checks the closed shape on its own", () => {
    expect(demoAnswerEnabled({ enabled: true })).toBe(true);
    expect(demoAnswerEnabled({})).toBe(false);
  });

  it("links the landing's button to the Lab's marker", () => {
    expect(DEMO_HREF).toBe("/lab#demo");
    expect(hasDemoMarker(DEMO_HASH)).toBe(true);
    expect(hasDemoMarker("#demo2")).toBe(false);
    expect(hasDemoMarker("")).toBe(false);
  });
});
