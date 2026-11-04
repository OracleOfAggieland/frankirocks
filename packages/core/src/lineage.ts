/**
 * Lineage resolver (R24.4; KC03, W-LINEAGE). Pure and deterministic: it takes a Memory, the Evidence it may cite,
 * and optionally the Spans that produced it, and returns either every resolved link or every failed link.
 *
 * Checks, each labeled:
 *   missingEvidence    a root Slice or Span names Evidence that is absent or belongs to another Owner
 *   sliceHashMismatch  a root Slice's contentHash is not the hash of the Evidence text at its field and range,
 *                      or the root Slice's range is empty (start === end)
 *   spanQuoteMismatch  a Span's quote is not the LF-normalized Evidence text at its field and range, or the
 *                      Span's range is empty (start === end, so it quotes no Evidence text)
 *   rootKeyMismatch    rootKeys[i] is not H(rootSlices[i]), or the two arrays differ in length
 *   missingDependsOn   a root Slice's eid has no `e:<eid>` entry in dependsOn
 * An empty `rootSlices` or `dependsOn` is reported as a failure too (a Memory must have lineage). An empty range is
 * a failure because a Memory must resolve to Evidence text, and `[n, n)` resolves to none (KC03, never stubbed).
 */
import { evidenceFieldText } from "./evidence";
import { type Hasher, rootKey } from "./ids";
import type { Slice, Span } from "./schema/primitives";
import type { Evidence, Memory } from "./schema/records";
import type { LineageFailureKind } from "./schema/wire";
import { sliceHashMatches } from "./slices";
import { textAt } from "./text";

export interface LineageFailure {
  kind: LineageFailureKind;
  /** Index into rootSlices (or spans, for spanQuoteMismatch and span missingEvidence). -1 for whole-record checks. */
  index: number;
  eid: string | null;
  /** "slice" or "span": which list `index` refers to. */
  on: "slice" | "span" | "record";
}

export interface ResolvedLink {
  slice: Slice;
  evidence: Evidence;
  /** The Evidence text at the Slice's range. */
  text: string;
}

export interface ResolvedSpan {
  span: Span;
  evidence: Evidence;
  text: string;
}

export type LineageResult =
  | { ok: true; links: ResolvedLink[]; spans: ResolvedSpan[] }
  | { ok: false; failures: LineageFailure[]; links: ResolvedLink[]; spans: ResolvedSpan[] };

export interface ResolveInput {
  memory: Pick<Memory, "uid" | "rootSlices" | "rootKeys" | "dependsOn">;
  /** Evidence by eid. Evidence with a different uid counts as missing (Tenant_Root check). */
  evidence: ReadonlyMap<string, Evidence>;
  hasher: Hasher;
  /** The Spans that produced the Memory, when known (extraction output). */
  spans?: readonly Span[];
}

export function resolveLineage(input: ResolveInput): LineageResult {
  const { memory, hasher } = input;
  const failures: LineageFailure[] = [];
  const links: ResolvedLink[] = [];
  const spans: ResolvedSpan[] = [];
  const lookup = (eid: string): Evidence | null => {
    const e = input.evidence.get(eid);
    return e !== undefined && e.uid === memory.uid ? e : null;
  };

  // No root Slice means no Evidence is resolved at all.
  if (memory.rootSlices.length === 0) failures.push({ kind: "missingEvidence", index: -1, eid: null, on: "record" });
  if (memory.dependsOn.length === 0) failures.push({ kind: "missingDependsOn", index: -1, eid: null, on: "record" });
  if (memory.rootKeys.length !== memory.rootSlices.length) failures.push({ kind: "rootKeyMismatch", index: -1, eid: null, on: "record" });

  const deps = new Set(memory.dependsOn);
  memory.rootSlices.forEach((slice, index) => {
    const key = memory.rootKeys[index];
    if (key !== undefined && key !== rootKey(slice, hasher)) failures.push({ kind: "rootKeyMismatch", index, eid: slice.eid, on: "slice" });
    if (!deps.has(`e:${slice.eid}`)) failures.push({ kind: "missingDependsOn", index, eid: slice.eid, on: "slice" });
    const evidence = lookup(slice.eid);
    if (evidence === null) {
      failures.push({ kind: "missingEvidence", index, eid: slice.eid, on: "slice" });
      return;
    }
    const fieldText = evidenceFieldText(evidence, slice.fieldPath);
    const text = fieldText !== null && slice.start !== null && slice.end !== null ? textAt(fieldText, slice.start, slice.end) : null;
    if (fieldText === null || text === null || slice.start === slice.end || !sliceHashMatches(slice, fieldText, hasher)) {
      failures.push({ kind: "sliceHashMismatch", index, eid: slice.eid, on: "slice" });
      return;
    }
    links.push({ slice, evidence, text });
  });

  (input.spans ?? []).forEach((span, index) => {
    const evidence = lookup(span.eid);
    if (evidence === null) {
      failures.push({ kind: "missingEvidence", index, eid: span.eid, on: "span" });
      return;
    }
    const fieldText = evidenceFieldText(evidence, span.fieldPath);
    const text = fieldText === null ? null : textAt(fieldText, span.start, span.end);
    if (text === null || span.start === span.end || text !== span.quote) {
      failures.push({ kind: "spanQuoteMismatch", index, eid: span.eid, on: "span" });
      return;
    }
    spans.push({ span, evidence, text });
  });

  return failures.length === 0 ? { ok: true, links, spans } : { ok: false, failures, links, spans };
}
