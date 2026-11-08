import { APIError } from "openai";
import { describe, expect, it } from "vitest";
import { callRoute, testRig } from "../testing/fakes";
import { DEPENDENCY_MESSAGE_CAP } from "./errors";
import type { RouteSpec } from "./runtime";

/** A route whose run throws `thrown`, so runRoute maps it to DEPENDENCY and logs it. */
const throwing = (thrown: unknown): RouteSpec<null> => ({
  name: "probe",
  parse: () => null,
  run: async () => {
    throw thrown;
  },
});

async function dependencyLine(thrown: unknown) {
  const rig = testRig();
  const res = await callRoute(rig, throwing(thrown), {});
  expect([res.status, res.body.error]).toEqual([503, "DEPENDENCY"]);
  const lines = rig.logs.filter((l) => l.event === "route.dependency");
  expect(lines).toHaveLength(1);
  return lines[0]!.fields;
}

describe("route.dependency log line (brief 005 item 1)", () => {
  it("names a Firestore-style error's gRPC code and keeps its message", async () => {
    const e = Object.assign(new Error("10 ABORTED: Transaction lock timeout."), { code: 10 });
    expect(await dependencyLine(e)).toEqual({ route: "probe", error: "Error", code: "ABORTED", message: "10 ABORTED: Transaction lock timeout." });
  });

  it("keeps a string code such as an Admin SDK one", async () => {
    const e = Object.assign(new Error("Error while making request: socket hang up"), { code: "app/network-error" });
    expect(await dependencyLine(e)).toMatchObject({ code: "app/network-error", message: "Error while making request: socket hang up" });
  });

  it("logs a plain Error's name and message, with no code", async () => {
    expect(await dependencyLine(new TypeError("fetch failed"))).toEqual({ route: "probe", error: "TypeError", message: "fetch failed" });
  });

  it("logs only `unknown` for a non-Error throw", async () => {
    expect(await dependencyLine("My dog is called Pip")).toEqual({ route: "probe", error: "unknown" });
    expect(await dependencyLine({ code: 10, message: "My dog is called Pip" })).toEqual({ route: "probe", error: "unknown" });
  });

  it("cuts a message over 200 characters", async () => {
    const long = `14 UNAVAILABLE: ${"x".repeat(400)}`;
    const fields = await dependencyLine(Object.assign(new Error(long), { code: 14 }));
    expect(fields.code).toBe("UNAVAILABLE");
    expect(fields.message).toBe(long.slice(0, DEPENDENCY_MESSAGE_CAP));
    expect((fields.message as string).length).toBe(200);
  });

  it("logs only the code of an OpenAI API error, whose message can quote the input", async () => {
    const e = new APIError(400, { message: "Invalid value: 'My dog is called Pip'", code: "invalid_value" }, undefined, new Headers());
    const fields = await dependencyLine(e);
    expect(fields).toMatchObject({ route: "probe", code: "invalid_value" });
    expect(fields).not.toHaveProperty("message");
    expect(JSON.stringify(fields)).not.toContain("Pip");
  });

  it("logs no message for a SyntaxError, which quotes the text JSON.parse failed on", async () => {
    let thrown: unknown;
    try {
      JSON.parse("My dog is called Pip");
    } catch (e) {
      thrown = e;
    }
    const fields = await dependencyLine(thrown);
    expect(fields).toEqual({ route: "probe", error: "SyntaxError" });
  });

  it("drops a code that is not an identifier", async () => {
    const e = Object.assign(new Error("boom"), { code: "My dog is called Pip" });
    expect(await dependencyLine(e)).toEqual({ route: "probe", error: "Error", message: "boom" });
  });
});
