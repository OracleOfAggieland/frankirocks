// The browser asks the seed reset for one persona by ID (brief 027), and the server knows one persona by ID
// (brief 019). The browser cannot import server code, so each side holds the literal. This check keeps them equal.
import { describe, expect, it } from "vitest";
import { PERSONA_FIXTURE_ID as CLIENT_ID } from "../apps/web/src/client/seed-guesses";
import { PERSONA_FIXTURE_ID as SERVER_ID } from "../packages/server/src/seed/persona";

describe("the persona's fixture ID", () => {
  it("is the same in the browser and in the seed", () => {
    expect(CLIENT_ID).toBe(SERVER_ID);
  });
});
