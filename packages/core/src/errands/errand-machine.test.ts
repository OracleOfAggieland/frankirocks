import { describe, expect, it } from "vitest";
import { ERRAND_STATUSES } from "../schema/records";
import { ERRAND_MOVES, type ErrandEvent, errandWaiting, nextErrandStatus } from "./errand-machine";

const EVENTS: ErrandEvent[] = ["result", "runFailed", "delivered", "expired", "forget"];

describe("server.errand", () => {
  it("has a move for every status and event, and never returns to running", () => {
    for (const s of ERRAND_STATUSES) for (const e of EVENTS) expect(nextErrandStatus(s, e)).not.toBe("running");
    expect(Object.keys(ERRAND_MOVES).sort()).toEqual([...ERRAND_STATUSES].sort());
  });

  it("running ends once; a waiting result ends once; a forget drops all but dropped", () => {
    expect(nextErrandStatus("running", "result")).toBe("ready");
    expect(nextErrandStatus("running", "runFailed")).toBe("failed");
    expect(nextErrandStatus("ready", "delivered")).toBe("delivered");
    expect(nextErrandStatus("failed", "expired")).toBe("cardOnly");
    expect(nextErrandStatus("delivered", "delivered")).toBeNull();
    expect(nextErrandStatus("cardOnly", "delivered")).toBeNull();
    for (const s of ERRAND_STATUSES) expect(nextErrandStatus(s, "forget")).toBe(s === "dropped" ? null : "dropped");
    expect(ERRAND_STATUSES.filter(errandWaiting)).toEqual(["ready", "failed"]);
  });
});
