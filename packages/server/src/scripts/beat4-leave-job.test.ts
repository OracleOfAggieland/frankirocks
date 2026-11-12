/**
 * Beat 4 (spec §15, 1:30–1:50): "I might leave my job." Warm first, and nothing written as a change. Next turn, at
 * 200 h: "Jordan's email still has no reply from you. Want a reminder Thursday?" The Lab: Read {n} emails. Guessed 3
 * private things. Said none. At 200 h, tap "Someone walked in": same question, narrower answer.
 *
 * {n} is the seed's own count of email rows. The three guesses are never said anywhere (spec §12 Friend Test 12).
 */
import type { Memory } from "@franki/core";
import { PERSONA } from "../seed/persona";
import { type Script, type World, allMemories, extract, item, memoryText, parse, reply, scriptSuite, spanOf } from "../testing/script-runner";

const LINE = "I might leave my job.";
const SEED_MAIL = PERSONA.lines.filter((l) => l.kind === "mail").length;
const guess = { memory: "a private guess", pick: (m: Memory) => m.kind === "hypothesis" };

/** A careful extractor files a hedged intention, not a change to the job. */
const hedged = (w: World) => [
  item({
    act: "intention",
    kind: "fact",
    predicate: "fact",
    value: { kind: "text", text: "might leave their job" },
    args: { topic: "work", label: "maybe leaving" },
    spans: [spanOf(w, "I might leave my job")],
    sens: "S1",
  }),
];

async function jobUnchanged(w: World): Promise<true | string> {
  const all = await allMemories(w);
  const job = all.filter((m) => m.data.predicate === "employment.status" || m.data.predicate === "employment.role");
  const moved = job.filter((m) => m.data.status !== "active" || m.data.rev !== 1 || m.data.validTo !== null);
  const changes = all.filter((m) => m.data.replacesIds.length > 0 || m.data.closesId !== null || m.data.status === "history" || m.data.status === "retracted");
  if (job.length !== 2) return `found ${job.length} job Memories`;
  if (moved.length > 0) return `job Memory changed: ${moved.map((m) => `${m.data.predicate} ${m.data.status} rev ${m.data.rev}`).join("; ")}`;
  if (changes.length > 0) return `a change was written: ${changes.map((m) => `${m.data.predicate} "${memoryText(m.data)}" ${m.data.status}`).join("; ")}`;
  return true;
}

const BEAT4: Script = {
  name: "beat 4: I might leave my job",
  scores: "spec §15 1:30–1:50, Friend Tests 12 and 13",
  steps: [
    { label: "load the seed for a visit", do: "seed", visit: "beat4" },
    { label: "open a session", do: "open" },
    {
      label: "type the line",
      do: "type",
      text: LINE,
      answers: [reply("That's a big thing to sit with. Do you want to talk it through?"), parse()],
      expect: [{ mustSay: { note: true } }],
    },
    {
      label: "the reply is care first",
      do: "check",
      of: "type the line",
      waits: "persona tuning and the warmth floor (brief 024 'not built', spec §14 addition 2): no care template or handling exists for a hard disclosure, so the reply is whatever the model words",
      expect: [{ mustSay: { template: "care.first", channel: "note" } }],
    },
    {
      label: "extraction runs behind the reply",
      do: "work",
      answers: [extract("a hedged intention about the job, no change", hedged)],
      expect: [{ store: "the job Memories unchanged, and nothing written as a change", check: jobUnchanged }],
    },
    {
      label: "the next turn: Jordan's email has no reply",
      do: "type",
      text: "Yeah. I don't know yet.",
      answers: [reply("No rush. It's yours to decide."), parse()],
      waits: "spec §14 addition 1 (the recruiter line), and a route calling brief 024's whispers: nothing reads the unanswered Jordan thread into a turn",
      expect: [{ mustSay: { has: ["Jordan", "Thursday"], channel: "note" } }],
    },
    {
      label: "the Lab: read {n} emails, guessed 3 private things, said none",
      do: "read",
      view: "lab",
      expect: [{ lab: { readEmails: SEED_MAIL, guessLinesSpoken: 0 } }],
    },
    {
      label: "the Lab counts the 3 private guesses",
      do: "check",
      of: "the Lab: read {n} emails, guessed 3 private things, said none",
      expect: [{ lab: { privateGuesses: 3 } }],
    },
    {
      label: "tap: someone walked in",
      do: "tap",
      control: "walkedIn",
      expect: [{ mustSay: { note: true } }],
    },
  ],
  neverSay: { tokens: [guess, "ready to leave Corvel", "Money may feel tight", "wearing Riley down"] },
};

scriptSuite(BEAT4);
