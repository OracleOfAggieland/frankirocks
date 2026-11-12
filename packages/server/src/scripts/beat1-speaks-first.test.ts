/**
 * Beat 1 (spec §15, 0:00–0:20): Franki speaks first, by `proactive`: "Good luck at 2. If the gap year comes up, you
 * had a good answer Tuesday." The card shows it moved from yesterday. The wish is said once (Friend Test 1).
 */
import type { Evidence, Memory } from "@franki/core";
import { type Script, type World, allEvidence, memoryText, scriptSuite } from "../testing/script-runner";

const interview = { what: "the interview occasion", pick: (m: Memory) => m.kind === "event" && memoryText(m).includes("interview") };
const gapYear = { what: "Tuesday's gap-year answer", pick: (m: Memory) => m.kind === "episode" && memoryText(m).includes("good answer about the gap year") };

const WISH_WAITS = "the wish is said on open (brief 030 part A) but its line names the occasion only; nothing in moments derive or the wish words joins the gap-year answer to it (brief 036's folder)";

async function interviewMoved(w: World): Promise<true | string> {
  const revs = (await allEvidence(w))
    .filter((e) => e.data.kind === "calendar" && e.data.title === "Tessellate Labs final interview")
    .map((e) => e.data as Evidence & { observation: { start: string; scheduleRev: number } });
  const local = (ts: string) => new Intl.DateTimeFormat("en-CA", { timeZone: w.zone, dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(Date.parse(ts));
  const shown = revs.map((r) => `rev ${r.observation.scheduleRev} at ${local(r.observation.start)}${r.isCurrentProvider ? " (current)" : ""}`).sort();
  const today = w.friday!;
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  const want = [`rev 1 at ${yesterday}, 14:00`, `rev 2 at ${today}, 14:00 (current)`];
  return shown.join("; ") === want.join("; ") ? true : `found ${shown.join("; ") || "no revisions"}; wanted ${want.join("; ")}`;
}

const BEAT1: Script = {
  name: "beat 1: Franki speaks first",
  scores: "spec §15 0:00–0:20, Friend Test 1",
  steps: [
    { label: "load the seed for a visit", do: "seed", visit: "beat1" },
    {
      label: "the interview moved from yesterday 14:00 to today 14:00",
      do: "setup",
      what: "no action: a store check on the seeded calendar",
      run: async () => {},
      expect: [{ store: "two revisions of the interview, the current one today at 14:00", check: interviewMoved }],
    },
    {
      label: "open a session",
      do: "open",
      expect: [
        { mustUse: interview, channel: "head" },
        { mustUse: gapYear, channel: "head" },
      ],
    },
    {
      label: "the wish for the interview at 2 is said first",
      do: "check",
      of: "open a session",
      expect: [{ mustSay: { template: "occasion.wish", has: ["2"], channel: "proactive" } }],
    },
    {
      label: "the wish carries the texture about the gap year",
      do: "check",
      of: "open a session",
      waits: WISH_WAITS,
      expect: [
        { mustUse: gapYear, channel: "proactive" },
        { mayUse: { what: "the interview and the gap-year answer", pick: (m) => interview.pick(m) || gapYear.pick(m) } },
      ],
    },
    {
      label: "the card shows the move from yesterday",
      do: "check",
      of: "open a session",
      waits: "brief 023 (the occasion's moment and its card) and 027 (the visit in the browser); no route returns a card on open",
      expect: [{ mustSay: { template: "occasion.moved", channel: "card" } }],
    },
    { label: "the wish plays on the call", do: "play", of: "open a session" },
    { label: "close the session", do: "close" },
    {
      label: "the next open does not wish again",
      do: "open",
      expect: [{ mustSay: { template: "occasion.wish", channel: "proactive", times: 0 } }],
    },
  ],
};

scriptSuite(BEAT1);
