/**
 * The persona's facts the demo depends on (spec §15), read back from a loaded clone, not from the fixture source.
 */
import type { Evidence, Memory } from "@franki/core";
import { describe, expect, it } from "vitest";
import { testRig } from "../testing/fakes";
import { listTenantRows } from "./clear";
import { addDays, cloneWorldStart, localDate, localMinute, weekdayOf } from "./clock";
import { awaitingReply } from "./hero-check";
import { loadSeed } from "./load";
import { PERSONA } from "./persona";
import { SEED_PARSER_VERSION, seedIds } from "./build";
import { msFromTs } from "@franki/core";

const UID = "owner-1";
const ZONE = "America/New_York";

async function clone() {
  const rig = testRig();
  const namespace = rig.deps.hasher.id(["ns", "persona-test"]);
  const worldStart = cloneWorldStart(rig.clock.read().opsClock.now, ZONE);
  await loadSeed(rig.deps, UID, { fixture: PERSONA, namespace, zone: ZONE, worldStart, core: { epoch: 1, policyRev: 1 } });
  const rows = await listTenantRows(rig.store, UID);
  const evidence = rows.filter((r) => r.path.includes("/evidence/")) as unknown as { id: string; data: Evidence }[];
  const memories = rows.filter((r) => r.path.includes("/memories/")).map((r) => r.data as unknown as Memory);
  return { rig, namespace, worldStart, friday: localDate(worldStart, ZONE), evidence, memories, ids: seedIds(namespace, rig.deps.hasher) };
}

const local = (ts: string) => ({ date: localDate(msFromTs(ts), ZONE), minute: localMinute(msFromTs(ts), ZONE) });

describe("the persona", () => {
  it("starts on a Friday at 08:40 in the visitor's zone", async () => {
    const { worldStart, friday } = await clone();
    expect(weekdayOf(friday)).toBe(5);
    expect(localMinute(worldStart, ZONE)).toBe(8 * 60 + 40);
  });

  it("has 40 Memories of Riley's own words and 3 private guesses, proposed only", async () => {
    const { memories } = await clone();
    const own = memories.filter((m) => m.sourceClass === "U");
    expect(own).toHaveLength(40);
    expect(own.every((m) => m.status === "active")).toBe(true);
    const guesses = memories.filter((m) => m.kind === "hypothesis");
    expect(guesses).toHaveLength(3);
    for (const g of guesses) expect(g).toMatchObject({ status: "alleged", sourceClass: "M", sens: "S2", flow: "never_outbound", sayAs: null });
    expect(memories).toHaveLength(43);
  });

  it("has 30 full emails, 8 of them Riley's, and 60 bulk ones", async () => {
    const { evidence } = await clone();
    const mail = evidence.filter((e) => e.data.kind === "message");
    const bulk = mail.filter((e) => e.data.route === "list");
    const full = mail.filter((e) => e.data.route !== "list");
    expect(full).toHaveLength(30);
    expect(full.filter((e) => e.data.authorship === "self")).toHaveLength(8);
    expect(bulk).toHaveLength(60);
  });

  it("the interview is today at 14:00, moved from yesterday at 14:00", async () => {
    const { evidence, friday, ids } = await clone();
    const revisions = evidence.filter((e) => e.data.logicalId === ids.logical("cal-interview")).sort((a, b) => (a.data.assertedAt < b.data.assertedAt ? -1 : 1));
    expect(revisions).toHaveLength(2);
    const [was, now] = revisions.map((r) => r.data.observation);
    if (was?.kind !== "calendar" || now?.kind !== "calendar") throw new Error("not calendar rows");
    expect(local(was.start)).toEqual({ date: addDays(friday, -1), minute: 14 * 60 });
    expect(local(now.start)).toEqual({ date: friday, minute: 14 * 60 });
    expect([was.scheduleRev, now.scheduleRev]).toEqual([1, 2]);
    expect(revisions[1]!.data.revisionOf).toBe(revisions[0]!.id);
    expect(revisions.map((r) => r.data.isCurrentProvider)).toEqual([false, true]);
  });

  it("Riley said the interview moved to tomorrow at 2, and the resolver put it on Friday 14:00", async () => {
    const { memories, friday } = await clone();
    const interview = memories.find((m) => m.predicate === "event")!;
    expect(local(interview.time!.start)).toEqual({ date: friday, minute: 14 * 60 });
  });

  it("the gap-year answer is a told line from Tuesday", async () => {
    const { memories, friday } = await clone();
    const told = memories.find((m) => m.predicate === "episode" && m.value.kind === "text" && m.value.text.includes("good answer about the gap year"))!;
    expect(told.sourceClass).toBe("U");
    expect(local(told.assertedAt).date).toBe(addDays(friday, -3));
    expect(weekdayOf(local(told.assertedAt).date)).toBe(2);
  });

  it("Jordan's email still has no reply from Riley", async () => {
    const { evidence, ids } = await clone();
    expect(awaitingReply(evidence, ids.key("thread", "jordan-platform-role"))).toBe(true);
    // A thread Riley did answer is not awaiting a reply.
    expect(awaitingReply(evidence, ids.key("thread", "mara-luck"))).toBe(false);
  });

  it("holds no brother or other sibling, no allergy, no pet and no Biscuit anywhere", async () => {
    const { evidence, memories } = await clone();
    // Only the human-readable fields: the hashed IDs are random letters and can hold any short word.
    const prose = evidence.flatMap((e) => {
      const d = e.data as unknown as Record<string, unknown>;
      const body = d.body as { kind: string; text?: string } | null;
      return [d.subject, d.title, d.description, d.text, d.sender, body?.text, JSON.stringify(d.observation)];
    });
    const values = memories.map((m) => JSON.stringify([m.value, m.predicate, m.sayAs]));
    const text = [...prose, ...values].filter((s) => typeof s === "string").join("\n").toLowerCase();
    expect(text).toContain("tessellate");
    for (const word of ["brother", "sibling", "sister", "allerg", "biscuit", "shellfish", "dog", "cat named", "puppy"]) expect(text, word).not.toMatch(new RegExp(`\\b${word}`));
    expect(memories.some((m) => m.predicate === "allergy")).toBe(false);
    expect(memories.some((m) => m.value.kind === "enum" && ["brother", "sister", "sibling"].includes(m.value.code))).toBe(false);
  });

  it("marks every seeded Evidence as from an authored packet", async () => {
    const { evidence } = await clone();
    expect(PERSONA.origin).toBe("authored");
    expect(evidence.every((e) => e.data.parserVersion === SEED_PARSER_VERSION && e.data.source === "fixture")).toBe(true);
  });
});
