import { describe, expect, it } from "vitest";
import { fail, never, ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import { settle, testRig } from "../testing/fakes";
import { runWebSearch } from "./specialist";

const question = { query: "Which exhibitions are open tonight?", location: "Honolulu", timezone: "Pacific/Honolulu" };
const museum = { title: "Museum hours", url: "https://example.org/exhibitions" };
const festival = { title: "Festival program", url: "https://example.org/program" };
const citation = (source: typeof museum, start: number, end: number) =>
  ({ type: "url_citation" as const, ...source, start_index: start, end_index: end });

const searched = { type: "web_search_call", status: "completed" };
const message = (text: string, annotations: ReturnType<typeof citation>[]) =>
  ({ type: "message", status: "completed", content: [{ type: "output_text", text, annotations }] });

describe("hosted web search specialist", () => {
  it("returns a source beside each supported finding and leaves uncited guesses out", async () => {
    const rig = testRig();
    const first = "The museum closes at 8 p.m. citeturn0search0";
    const second = "An uncited restaurant may be open.";
    const third = "The festival opens at 6 p.m.";
    const text = [first, second, third].join("\n");
    const citations = [
      citation(museum, first.indexOf(""), first.length),
      citation(museum, first.indexOf(""), first.length),
      citation(festival, text.indexOf(third), text.length),
    ];
    rig.openai.script("responses.create", ok(normalizeResponse({ status: "completed", output_text: text, output: [searched, message(text, citations)] })));
    expect(await runWebSearch(rig.deps, question)).toEqual({ status: "found", findings: [
      { text: "The museum closes at 8 p.m.", sources: [museum] },
      { text: third, sources: [festival] },
    ] });
    const req = rig.openai.requests[0]!;
    expect(req.body).toMatchObject({
      model: rig.deps.env.FRANKI_BRAIN_MODEL, store: false, tool_choice: "required", max_tool_calls: 3,
      tools: [{ type: "web_search", user_location: { type: "approximate", city: "Honolulu", timezone: "Pacific/Honolulu" } }],
    });
    expect(JSON.parse((req.body as { input: string }).input)).toEqual({
      question: question.query, location: "Honolulu", timezone: "Pacific/Honolulu", now: "2026-11-03T12:00:00.000Z", localDate: "2026-11-03",
    });
    expect(req.options?.timeoutMs).toBe(30_000);
    expect(rig.timers.pending).toBe(0);
  });

  it("resolves the date across midnight and applies no default city or country to general questions", async () => {
    const rig = testRig();
    const none = normalizeResponse({ status: "completed", output: [searched] });
    rig.openai.always("responses.create", ok(none));
    rig.clock.advance(20 * 60 * 60 * 1000);
    await runWebSearch(rig.deps, question);
    const b = rig.openai.requests[0]!.body as { input: string };
    expect(JSON.parse(b.input)).toMatchObject({ now: "2026-11-04T08:00:00.000Z", localDate: "2026-11-03" });
    await runWebSearch(rig.deps, { query: "When was this paper published?", timezone: "bogus/zone" });
    expect(rig.openai.requests[1]!.body).toMatchObject({ tools: [{ type: "web_search", user_location: { type: "approximate" } }] });
    expect(JSON.parse((rig.openai.requests[1]!.body as { input: string }).input)).toEqual({
      question: "When was this paper published?", now: "2026-11-04T08:00:00.000Z",
    });
    await runWebSearch(rig.deps, { ...question, requestedAt: Date.parse("2026-11-03T09:59:59Z") });
    expect(JSON.parse((rig.openai.requests[2]!.body as { input: string }).input)).toMatchObject({
      now: "2026-11-03T09:59:59.000Z", localDate: "2026-11-02",
    });
  });

  it("requires a completed search and valid URL annotations on the finding itself", async () => {
    const rig = testRig();
    const text = "A venue from a model-written [link](https://example.org).";
    const item = message(text, [citation(museum, 0, text.length)]);
    for (const output of [
      [item],
      [{ type: "web_search_call", status: "failed" }, item],
      [searched, { ...item, phase: "commentary" }],
      [searched, message(text, [])],
      [searched, message(text, [citation(museum, 0, text.length + 5)])],
      [searched, message(text, [citation({ ...museum, url: "javascript:alert(1)" }, 0, text.length)])],
      [searched, message("line one\nline two", [citation(museum, 0, 17)])],
    ]) {
      rig.openai.script("responses.create", ok(normalizeResponse({ status: "completed", output, output_text: text })));
      expect(await runWebSearch(rig.deps, question)).toEqual({ status: "unverified" });
    }
  });

  it("bounds results and drops oversized findings to preserve their qualifiers", async () => {
    const rig = testRig();
    const lines = ["a".repeat(420), "Place one.", "Place two.", "Place three.", "Place four."];
    const output = [searched, ...lines.map((line) => message(line, [citation(museum, 0, line.length)]))];
    rig.openai.script("responses.create", ok(normalizeResponse({ status: "completed", output })));
    expect(await runWebSearch(rig.deps, question)).toEqual({ status: "found", findings: lines.slice(1, 4).map((text) => ({ text, sources: [museum] })) });
  });

  it("keeps a citation on its line after a non-BMP character", async () => {
    const rig = testRig();
    const heading = "Unverified 🌙";
    const fact = "The public concert begins at 8.";
    const text = [heading, fact].join("\n");
    const item = message(text, [citation(festival, Array.from(heading).length + 1, Array.from(text).length)]);
    rig.openai.script("responses.create", ok(normalizeResponse({ status: "completed", output: [searched, item] })));
    expect(await runWebSearch(rig.deps, question)).toEqual({ status: "found", findings: [{ text: fact, sources: [festival] }] });
  });

  it("keeps linked venue names speakable and gets the destination only from the provider annotation", async () => {
    const rig = testRig();
    const text = "The [West Gallery](https://wrong.example) opens at ten. ([Museum hours](https://example.org/exhibitions))";
    const output = [searched, message(text, [citation(museum, text.indexOf("([Museum"), text.length)])];
    rig.openai.script("responses.create", ok(normalizeResponse({ status: "completed", output })));
    expect(await runWebSearch(rig.deps, question)).toEqual({ status: "found", findings: [
      { text: "The West Gallery opens at ten.", sources: [museum] },
    ] });
  });

  it("finishes a hung provider request once, releases its timer and supports early cancellation", async () => {
    const rig = testRig();
    rig.openai.always("responses.create", never());
    const { value, elapsedMs } = await settle(runWebSearch(rig.deps, question), rig.clock, rig.timers);
    expect(value).toEqual({ status: "unavailable" });
    expect(elapsedMs).toBe(30_000);
    expect(rig.openai.requests[0]?.options?.signal?.aborted).toBe(true);
    expect(rig.openai.requests).toHaveLength(1);
    const stop = new AbortController();
    const pending = runWebSearch(rig.deps, question, stop.signal);
    stop.abort();
    expect(await pending).toEqual({ status: "unavailable" });
    expect(await runWebSearch(rig.deps, question, stop.signal)).toEqual({ status: "unavailable" });
    expect(rig.openai.requests).toHaveLength(2);
    expect(rig.timers.pending).toBe(0);
  });

  it("suppresses provider errors, refusals and incomplete answers and rejects oversized requests", async () => {
    const rig = testRig();
    rig.openai.script("responses.create",
      fail(new Error("private query in provider error")),
      ok(normalizeResponse({ status: "incomplete", output: [searched] })),
      ok(normalizeResponse({ status: "completed", output: [searched, { type: "message", content: [{ type: "refusal", refusal: "refused" }] }] })),
    );
    for (let n = 0; n < 3; n++) expect(await runWebSearch(rig.deps, question)).toEqual({ status: "unavailable" });
    expect(await runWebSearch(rig.deps, { query: "x".repeat(601) })).toEqual({ status: "unavailable" });
    expect(rig.openai.requests).toHaveLength(3);
  });
});
