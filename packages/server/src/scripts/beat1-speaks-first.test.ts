/**
 * Beat 1 (spec §15, 0:00–0:20): Franki speaks first, by `proactive`: "Good luck at 2. If the gap year comes up, you
 * had a good answer Tuesday." The card shows it moved from yesterday. The wish is said once (Friend Test 1).
 *
 * Brief 052, contract question M-1 (owner's ruling, Nov 18: "Intro first, demo line after"): on a fresh sample visit
 * the first open says the first meeting's line (MEET_LINE) in the wish's place, so spec §15's order differs here. The
 * wish is not lost: the open's scheduled tick (`startTick`, run after the answer by `after()` in production, by the
 * `work` step here) leases it, and the state poll says it as an idle whisper at the call's first quiet moment
 * (`IDLE_SILENCE_MS`). It is still said exactly once.
 *
 * Brief 052 review F1: an offer counts only once its Session had a call. The runner's open and its live call stand in
 * for the browser but never post the SDP, so a step registers the call on the Session as the SDP route does before
 * the next open, which then makes the second offer.
 */
import type { Evidence, Memory, Session } from "@franki/core";
import { paths } from "../store/paths";
import { patchRecord } from "../testing/fakes";
import { type Script, type Step, type World, allEvidence, memoryText, scriptSuite } from "../testing/script-runner";

const callRegistered: Step = {
  label: "the call is registered on the session",
  do: "setup",
  what: "the session's call is registered, as the SDP route leaves it (review F1: the meet offer counts)",
  run: async (w) => {
    await patchRecord<Session>(w.rig.store, w.uid, paths.session(w.uid, w.sessionId!), { registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  },
};

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
    { label: "load the seed for a visit", do: "seed", visit: "beat1", firstMeeting: true },
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
      label: "the first meeting's line is said first, in the wish's place (M-1)",
      do: "check",
      of: "open a session",
      expect: [
        { mustSay: { template: "meet.first", channel: "proactive", times: 1 } },
        { mustSay: { template: "occasion.wish", channel: "proactive", times: 0 } },
      ],
    },
    { label: "the meet line plays on the call", do: "play", of: "open a session" },
    callRegistered,
    { label: "the open's scheduled tick runs", do: "work" },
    {
      label: "the wish for the interview at 2 is said at the first quiet moment",
      do: "idle",
      expect: [{ mustSay: { template: "occasion.wish", has: ["2"], channel: "proactive", times: 1 } }],
    },
    {
      label: "the wish carries the texture about the gap year",
      do: "check",
      of: "the wish for the interview at 2 is said at the first quiet moment",
      waits: WISH_WAITS,
      expect: [
        { mustUse: gapYear, channel: "proactive" },
        { mayUse: { what: "the interview and the gap-year answer", pick: (m) => interview.pick(m) || gapYear.pick(m) } },
      ],
    },
    {
      label: "the card shows the move from yesterday",
      do: "check",
      of: "the wish for the interview at 2 is said at the first quiet moment",
      waits: "brief 023 (the occasion's moment and its card) and 027 (the visit in the browser); no route returns a card with the wish",
      expect: [{ mustSay: { template: "occasion.moved", channel: "card" } }],
    },
    { label: "the wish plays on the call", do: "play", of: "the wish for the interview at 2 is said at the first quiet moment" },
    { label: "close the session", do: "close" },
    {
      label: "the next open does not wish again",
      do: "open",
      expect: [
        { mustSay: { template: "occasion.wish", channel: "proactive", times: 0 } },
        { mustSay: { template: "meet.again", channel: "proactive", times: 1 } },
      ],
    },
  ],
};

/**
 * Brief 045, finding 3: beat 1 on a live call. The wish plays through the real voice machine and the real routes
 * (the `call` step) once the machine has verified its Permit; no `play` stands in for the browser. Said once.
 * Brief 052 (M-1): the call opens with the meet line; the wish is heard at the call's first quiet moment.
 */
const BEAT1_ON_CALL: Script = {
  name: "beat 1: Franki speaks first, on a live call",
  scores: "spec §15 0:00–0:20, Friend Test 1",
  steps: [
    { label: "load the seed for a visit", do: "seed", visit: "beat1", firstMeeting: true },
    {
      label: "call",
      do: "call",
      expect: [
        { mustSay: { template: "meet.first", channel: "heard", times: 1 } },
        { mustSay: { template: "occasion.wish", channel: "heard", times: 0 } },
      ],
    },
    callRegistered,
    { label: "the open's scheduled tick runs", do: "work" },
    { label: "quiet", do: "callQuiet", expect: [{ mustSay: { template: "occasion.wish", has: ["2"], channel: "heard", times: 1 } }] },
    { label: "hang up", do: "hangUp" },
    {
      label: "call again",
      do: "call",
      expect: [
        { mustSay: { template: "occasion.wish", channel: "heard", times: 0 } },
        { mustSay: { template: "meet.again", channel: "heard", times: 1 } },
      ],
    },
  ],
};

scriptSuite(BEAT1);
scriptSuite(BEAT1_ON_CALL);
