import { OpenRequest, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { createApiClient } from "./api";
import { createBrowserClock } from "./clock";
import { TypedTurns } from "./typed-turns";

/** Brief 030 P1-8: the typed path's open names the visit whose clone answered, so the server can check it. */
describe("typed open and the visit", () => {
  const opened = async (visitId?: () => string | null) => {
    const bodies: unknown[] = [];
    const fetch = async (input: string, init: RequestInit) => {
      if (input.endsWith("/api/session/open")) bodies.push(JSON.parse(String(init.body)));
      return Response.json({ error: "INTERNAL", retryAfterMs: 0 }, { status: 500 });
    };
    const api = createApiClient({ getToken: async () => "token:owner-1", fetch });
    const clock = createBrowserClock({ zone: "America/Chicago", monotonic: { timeOrigin: 0, now: () => 0 } });
    const typed = new TypedTurns({ api, clock, ...(visitId === undefined ? {} : { visitId }) });
    typed.setText("hello");
    await typed.submit();
    return bodies as { visitId: string | null; surface?: string }[];
  };

  it("sends the visit it is given, and null without one", async () => {
    expect((await opened(() => "visit-1"))[0]!.visitId).toBe("visit-1");
    expect((await opened(() => null))[0]!.visitId).toBeNull();
    expect((await opened())[0]!.visitId).toBeNull();
  });

  it("brief 052 (M-5): names its surface as typed, a body the open route's schema accepts", async () => {
    const [body] = await opened(() => testId("visit-1"));
    expect(body!.surface).toBe("typed");
    expect(validate(OpenRequest, body).ok).toBe(true);
  });
});
