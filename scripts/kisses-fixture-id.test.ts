// The browser asks the seed reset for the demo persona by ID, and shows the persona's name in the account menu
// (brief 054, R3.3, R6.7). The browser cannot import server code, so each side holds the literals. This check keeps
// them equal, as persona-fixture-id.test.ts does for the first persona.
import { describe, expect, it } from "vitest";
import { DEMO_NAME, KISSES_FIXTURE_ID as CLIENT_ID } from "../apps/web/src/client/demo";
import { KISSES, KISSES_FIXTURE_ID as SERVER_ID } from "../packages/server/src/seed/kisses";

describe("the demo persona's fixture ID and name", () => {
  it("is the same ID in the browser and in the seed", () => {
    expect(CLIENT_ID).toBe(SERVER_ID);
    expect(CLIENT_ID).toBe(KISSES.id);
  });

  it("is the same name in the browser and in the fixture's demo profile", () => {
    expect(DEMO_NAME).toBe(KISSES.demo?.displayName);
  });
});
