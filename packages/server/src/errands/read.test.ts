// Owner, Nov 19: `read_errand_result`, and the certain-speaker ruling for errands (company-off.ts). In the Nov 19 live
// test a calendar errand answered correctly, but no tool could read it and the owner was told nothing came back.
import { ERRAND_HELD_LINE, ERRAND_NONE_READ_LINE, ERRAND_SILENCE_MS, type Errand, errandRunningNote } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { stateRoute } from "../routes/state";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { type ErrandSetup, ERRAND_OWNER as UID, errandOf, poll, errandSetup as setup, tool } from "../testing/errand-agent";
import { TEST_ENV, callRoute, runScheduled } from "../testing/fakes";
import { asrTurn } from "../testing/session-fixtures";
import { errandIdOf } from "./records";

const offEnv = (): Record<string, string> => {
  const env: Record<string, string> = { ...TEST_ENV };
  delete env.FRANKI_COMPANY_MODE;
  return env;
};
const FOUND = [{ call: "search_mail" }, { outcome: "answered" as const, lines: [{ text: "The plumber comes Thursday at 9.", refs: ["r1"] }] }];

/** The owner asks, by voice with no judge verdict (as every turn of the live test was), whether anything came back. */
async function ask(x: ErrandSetup, seq = 2, judge: "O" | "timeout" = "timeout") {
  const turn = await callRoute(x.rig, turnRoute, { ...asrTurn({ ...x.stamp, generation: 1 } as never, seq, "Did you get anything back from my mail?", [{ itemId: `item${seq}`, commitSeq: seq }], "final", seq), judge });
  expect(turn.status).toBe(200);
  const res = await callRoute(x.rig, toolRoute, { requestId: testId(`read-${seq}`), stamp: turn.body.stamp, callId: `read${seq}`, tool: { name: "read_errand_result", args: {} } });
  expect(res.status).toBe(200);
  return res.body;
}

describe("read_errand_result (owner, Nov 19)", () => {
  it("with company mode off, reads a finished result to a voice turn with no judge O, and the pause says it no more", async () => {
    const x = await setup(FOUND, { env: offEnv(), judge: "timeout" });
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    expect((await errandOf(x))?.gate?.certain).toBe(true); // errandGateInputs: the asking voice line is certain now
    const body = await ask(x);
    expect(body.status).toBe("ready");
    expect(body.result.name).toBe("read_errand_result");
    expect(body.result.state).toBe("found");
    expect(body.result.notes[0].text).toContain("The plumber comes Thursday at 9.");
    expect(body.result.notes[0].text).toContain("From Pat Plumber");
    expect((await errandOf(x))?.status).toBe("delivered");
    x.rig.clock.advance(ERRAND_SILENCE_MS + 100);
    const st = await callRoute(x.rig, stateRoute, poll(x));
    expect(st.body.proactive?.whisper.text ?? "").not.toContain("Thursday");
    // Asked again, it still answers from the delivered result (its card keeps it).
    expect((await ask(x, 3)).result.notes[0].text).toContain("The plumber comes Thursday at 9.");
  });

  it("with company mode off, the pause says a result asked by a voice turn with no judge O", async () => {
    const x = await setup(FOUND, { env: offEnv(), judge: "timeout" });
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    x.rig.clock.advance(ERRAND_SILENCE_MS + 100);
    const st = await callRoute(x.rig, stateRoute, poll(x));
    expect(st.body.proactive?.whisper.text).toContain("Thursday");
  });

  it("with company mode on, an S1 result asked with no judge O is the held line and stays waiting", async () => {
    const x = await setup(FOUND, { judge: "timeout" });
    x.mail[0] = { ...x.mail[0]!, sens: "S1" };
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    expect((await errandOf(x))?.gate?.certain).toBe(false);
    const body = await ask(x);
    expect(body.result.state).toBe("found");
    expect(body.result.notes.map((n: { text: string }) => n.text)).toEqual([ERRAND_HELD_LINE]);
    expect((await errandOf(x))?.status).toBe("ready");
  });

  it("with company mode on and judge O, reads the result in full", async () => {
    const x = await setup(FOUND);
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    const body = await ask(x, 2, "O");
    expect(body.result.notes[0].text).toContain("The plumber comes Thursday at 9.");
  });

  it("says a look-up still running, and nothing invented when there is none", async () => {
    const x = await setup([{ never: true }], { env: offEnv() });
    const none = await ask(x);
    expect(none.result).toMatchObject({ state: "none", notes: [{ text: ERRAND_NONE_READ_LINE, sens: "S0" }] });

    const y = await setup([{ never: true }], { env: offEnv() });
    await callRoute(y.rig, toolRoute, tool(y));
    const running = await ask(y);
    expect(running.result).toMatchObject({ state: "running", notes: [{ text: errandRunningNote(["mail"]), sens: "S0" }] });
  });

  it("reads only this Session's results", async () => {
    const x = await setup(FOUND, { env: offEnv() });
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    const id = errandIdOf(x.rig.deps.hasher, x.sessionId, x.stamp.turnId);
    await x.rig.store.transaction(UID, async (tx) => {
      const doc = await tx.get<Errand>(paths.errand(UID, id));
      tx.update(doc!.path, { ...doc!.data, sessionId: testId("another-session") });
    });
    expect((await ask(x)).result.state).toBe("none");
  });
});
