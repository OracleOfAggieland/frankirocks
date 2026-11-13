// Brief 047, ruling 9: purge is the one in-place change to Evidence content and Memory value, and it only removes.
import { type Evidence, type Memory, purgedEvidence } from "@franki/core";
import { sampleEvidence, sampleMemory, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { checkImmutable } from "./checks";
import { parseDocPath, paths } from "./paths";

const UID = "owner-1";
const ev = parseDocPath(UID, paths.evidence(UID, testId("ev")));
const mem = parseDocPath(UID, paths.memory(UID, testId("mem")));
const asRow = (x: Evidence | Memory) => x as unknown as Record<string, unknown>;
const now = "2026-11-13T12:00:00.000Z";

describe("checkImmutable and purge", () => {
  const e = { ...sampleEvidence({ text: { kind: "inline", text: "Danny loves gumbo." } }), status: "blocked" as const };

  it("lets purge null Evidence content when the next status is purged", () => {
    expect(() => checkImmutable(ev, asRow(e), asRow(purgedEvidence(e, now)))).not.toThrow();
  });

  it("refuses any other change to Evidence content, purged or not", () => {
    expect(() => checkImmutable(ev, asRow(e), asRow({ ...e, text: null }))).toThrow(/immutable/);
    expect(() => checkImmutable(ev, asRow(e), asRow({ ...purgedEvidence(e, now), text: { kind: "inline", text: "Danny" } }))).toThrow(/immutable/);
    expect(() => checkImmutable(ev, asRow(e), asRow({ ...purgedEvidence(e, now), fieldSlices: [] }))).toThrow(/immutable/);
  });

  it("lets a blocked, retracted or wrong Memory lose its value, and nothing else", () => {
    const m = sampleMemory({ value: { kind: "text", text: "gumbo" }, status: "blocked" });
    expect(() => checkImmutable(mem, asRow(m), asRow({ ...m, value: { kind: "text", text: "" } }))).not.toThrow();
    expect(() => checkImmutable(mem, asRow({ ...m, status: "active" }), asRow({ ...m, status: "active", value: { kind: "text", text: "" } }))).toThrow(/immutable/);
    expect(() => checkImmutable(mem, asRow(m), asRow({ ...m, value: { kind: "text", text: "paella" } }))).toThrow(/immutable/);
  });
});
