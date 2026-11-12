// Feature: brief 036, property 5 "Said needs a played, matching, admitted reply" (contracts §6 "saidAt=admitted+
// (idTagged|exactTemplate|candidateAndReason), else null"; spec §6 "No row, no claim"). On the server path over the
// in-memory store, with the ops clock moving: a wish is put on the wire, then receipts arrive in any order, for its
// response or another (admitted with the right note or a stale one, playback started, cancelled, transcripts with
// the line or other words). `saidAt` is set only on a moment admitted on that response, after a playback start on
// it, with no cancel on it before, by a transcript that matches, and its ledger `delivery` row is written with it.
import { type Ledger, type Moment, localMinuteAt } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { testRig } from "../testing/fakes";
import { proactiveOf } from "./proactive";
import { admitMoment, deliveryEntryId, recordPlayback, recordSaid } from "./said";
import { momentsOf, ofKind, timeTenant, writeOccasion } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const DAY = "2026-11-13";
const ZONE = "America/Chicago";
const STAMP = { sessionId: testId("s"), epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId: testId("t") };
const RESPONSES = ["resp_a", "resp_b"] as const;

const receipt = fc.record({
  kind: fc.constantFrom("admitted", "admittedStale", "playbackStarted", "cancelled", "transcript"),
  response: fc.constantFrom(...RESPONSES),
  text: fc.constantFrom("line", "line!", "Good luck today.", ""),
  tagged: fc.boolean(),
  opsMs: fc.integer({ min: 0, max: 5_000 }),
});

describe("one-shot time, server path: said needs a played, matching, admitted reply", () => {
  it("saidAt only with an admission, a playback start, no cancel and a match, with its ledger row", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(receipt, { minLength: 1, maxLength: 8 }), async (rs) => {
        const rig = testRig();
        const ctx = await timeTenant(rig, UID, ZONE, localMinuteAt(DAY, 8 * 60 + 40, ZONE)!);
        await writeOccasion(rig, UID, "0", localMinuteAt(DAY, 14 * 60, ZONE)!, ZONE);
        await memoryTick(ctx);
        const [[id, wish]] = ofKind(await momentsOf(rig, UID), "wish") as [[string, Moment]];
        const p = (await proactiveOf(ctx, id as never, wish, STAMP))!;
        const seen = { admittedOn: null as string | null, played: new Set<string>(), cancelled: new Set<string>() };
        for (const r of rs) {
          rig.clock.advance(r.opsMs);
          await rig.store.transaction(UID, async (tx) => {
            if (r.kind === "admitted" || r.kind === "admittedStale") {
              const ok = await admitMoment(tx, UID, id as never, { responseId: r.response, noteIds: [r.kind === "admitted" ? p.whisper.noteId : "stale"] }, rig.deps);
              if (ok) seen.admittedOn = r.response;
            } else if (r.kind === "playbackStarted" || r.kind === "cancelled") {
              await recordPlayback(tx, UID, id as never, { kind: r.kind, responseId: r.response }, rig.clock);
              if (r.kind === "playbackStarted") seen.played.add(r.response);
              else seen.cancelled.add(r.response);
            } else {
              const text = r.text === "line" ? p.whisper.text : r.text === "line!" ? `${p.whisper.text}!` : r.text;
              const before = { played: seen.played.has(r.response), cancelled: seen.cancelled.has(r.response) };
              const match = await recordSaid(tx, UID, id as never, { kind: "transcript", responseId: r.response, momentIds: r.tagged ? [id] : [], noteIds: [], text }, "proactive", rig.clock, rig.deps.hasher);
              if (match !== null) {
                expect(seen.admittedOn).toBe(r.response);
                expect(before.played).toBe(true);
                expect(before.cancelled).toBe(false);
                expect(r.text === "line" || r.text === "line!").toBe(true);
              }
            }
          });
        }
        const m = (await momentsOf(rig, UID)).get(id)!;
        const row = m.responseId === null ? null : await rig.store.get<Ledger>(UID, paths.ledger(UID, deliveryEntryId(rig.deps.hasher, id, m.responseId)));
        expect(m.saidAt !== null).toBe(row !== null);
        if (m.saidAt !== null) expect(m.playbackAt).not.toBeNull();
      }),
      { numRuns: 1000 },
    );
  }, 120_000);
});
