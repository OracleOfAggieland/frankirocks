import { describe, expect, it } from "vitest";
import { testRig } from "../testing/fakes";
import { SeedLoadError, buildSeed } from "./build";
import { cloneWorldStart } from "./clock";
import { PERSONA } from "./persona";
import { type PacketReader, authoredReader, regenerateFixture, regenerates } from "./regenerate";

describe("regenerateFixture", () => {
  it("with the default reader returns the authored packets unchanged, marked regenerated", async () => {
    const out = await regenerateFixture(PERSONA);
    expect(out.origin).toBe("regenerated");
    expect(out.lines).toEqual(PERSONA.lines);
    expect(PERSONA.lines.filter(regenerates)).toHaveLength(29 + 22);
  });

  it("asks the reader only for model-read lines, and keeps every line's text", async () => {
    const asked: string[] = [];
    const reader: PacketReader = {
      live: false,
      turn: async (l) => (asked.push(l.id), { extract: [] }),
      mail: async (l) => (asked.push(l.id), {}),
    };
    const out = await regenerateFixture(PERSONA, reader);
    expect(asked).toEqual(PERSONA.lines.filter(regenerates).map((l) => l.id));
    for (const [i, line] of out.lines.entries()) {
      const was = PERSONA.lines[i]!;
      if (line.kind === "turn" && was.kind === "turn") expect([line.text, line.extract, line.privateRead]).toEqual([was.text, [], undefined]);
      else if (!regenerates(was)) expect(line).toEqual(was);
    }
  });

  it("refuses a live reader unless asked for by name", async () => {
    await expect(regenerateFixture(PERSONA, { ...authoredReader, live: true })).rejects.toThrow(/allowLive/);
  });

  it("the load refuses a regenerated fixture: it has no parser version of its own yet", async () => {
    const rig = testRig();
    const out = await regenerateFixture(PERSONA);
    const now = rig.clock.read().opsClock.now;
    const input = { uid: "owner-1", namespace: rig.deps.hasher.id(["ns"]), zone: "UTC", worldStart: cloneWorldStart(now, "UTC"), opsNow: now, core: { epoch: 1, policyRev: 1 }, hasher: rig.deps.hasher };
    await expect(buildSeed(out, input)).rejects.toBeInstanceOf(SeedLoadError);
  });
});
