/**
 * Extract worker.
 *
 * STUB (task 11). This version exists only so the lineage property can run before the extractor is written
 * (R24.5, R31.3). It writes one Memory per `new`/`update` Item and builds each root Slice straight from the
 * model's Span range, without checking the Span's eid, range or quote against the Evidence. Task 22 replaces it
 * with the real ExtractV1 extractor, and the lineage property must then pass.
 */
import {
  type ClockPort,
  type Evidence,
  type Hasher,
  type Job,
  type Memory,
  type Slice,
  idParts,
  rootKey,
  tsFromMs,
  utf8,
} from "@franki/core";
import type { Env } from "../config/env";
import { requireModel } from "../config/models";
import type { OpenAIPort } from "../openai/fake";
import type { ResponsesResult } from "../openai/responses";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";

export interface ExtractDeps {
  store: StorePort;
  openai: OpenAIPort;
  clock: ClockPort;
  hasher: Hasher;
  env: Env;
}

interface StubItem {
  act: string;
  target: string;
  kind: Memory["kind"];
  predicate: Memory["predicate"];
  value: Memory["value"];
  args: Record<string, unknown>;
  spans: { eid: string; fieldPath: Slice["fieldPath"]; start: number; end: number; quote: string }[];
  sens: Memory["sens"];
  gravity: number;
}

export async function runExtractJob(uid: string, jobId: string, deps: ExtractDeps): Promise<void> {
  const job = await deps.store.get<Job>(uid, paths.job(uid, jobId));
  if (job === null) throw new Error("extract stub: job not found");
  const eid = job.data.sourceIds[0]!;
  const evidence = await deps.store.get<Evidence>(uid, paths.evidence(uid, eid));
  if (evidence === null) throw new Error("extract stub: evidence not found");
  const text = evidence.data.text?.kind === "inline" ? evidence.data.text.text : "";

  const result = (await deps.openai.call("responses.create", {
    model: requireModel("brain", deps.env),
    input: text,
  })) as ResponsesResult;
  const output = JSON.parse(result.outputText ?? "") as { items: StubItem[] };

  const clock = deps.clock.read();
  const now = tsFromMs(clock.opsClock.now);
  const world = tsFromMs(clock.worldClock.now);

  await deps.store.transaction(uid, async (tx) => {
    const current = await tx.get<Job>(paths.job(uid, jobId));
    output.items.forEach((item, index) => {
      if (item.target !== "new" && item.target !== "update") return;
      // No verification: the Span's own eid and range are trusted.
      const rootSlices: Slice[] = item.spans.map((s) => ({
        eid: s.eid,
        fieldPath: s.fieldPath,
        start: s.start,
        end: s.end,
        contentHash: deps.hasher.sha256(utf8(text.slice(s.start, s.end))),
        class: "U",
        sens: "S0",
      }));
      const memory: Memory = {
        v: 1,
        uid,
        rev: 1,
        createdAt: now,
        updatedAt: now,
        epoch: job.data.epoch,
        policyRev: job.data.policyRev,
        rootKeys: rootSlices.map((s) => rootKey(s, deps.hasher)),
        rootSlices,
        contextIds: [],
        packetEids: [eid],
        dependsOn: [`e:${eid}`],
        dirty: false,
        dependenciesComplete: true,
        logicalId: deps.hasher.id(idParts.memory(jobId, index)),
        kind: item.kind,
        subjectId: "self",
        predicate: item.predicate,
        scopeId: "global",
        key: deps.hasher.id(idParts.memoryKey("self", item.predicate, "global")),
        value: item.value,
        args: item.args,
        bindings: [],
        status: "active",
        sourceClass: "U",
        sens: item.sens,
        closeReason: null,
        lastSupportAt: null,
        flow: "open",
        assertedAt: world,
        validFrom: world,
        validTo: null,
        validFromKey: world,
        validFromKnown: true,
        when: { kind: "none" },
        time: null,
        endWhen: { kind: "standing" },
        nextReviewAt: tsFromMs(clock.worldClock.now + 365 * 86_400_000),
        replacesIds: [],
        supportingIds: [{ type: "evidence", id: eid, rev: evidence.data.rev }],
        entityIds: [],
        topicIds: [],
        roleKeys: [],
        watchTokens: [],
        watches: [],
        anchorId: null,
        unboundStart: null,
        scheduleRev: 0,
        sayAs: null,
        texture: [],
        gravity: Math.min(3, Math.max(0, item.gravity)),
        closesId: null,
        possibleClosureSourceId: null,
        expectedArtifactId: null,
        embedding: null,
        vectorVersion: null,
        hypothesis: null,
        loop: null,
      };
      tx.create(paths.memory(uid, deps.hasher.id(idParts.memory(jobId, index))), memory);
    });
    tx.update(paths.job(uid, jobId), { ...current!.data, status: "complete", updatedAt: now });
  });
}
