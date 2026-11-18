import { type WebCitation, cleanErrandText, isWebCitationUrl } from "@franki/core";
import type { ResponseOutputText } from "openai/resources/responses/responses";

/** Each short, speakable fact carries the provider citations from its own line of the answer. */
export interface SearchFinding {
  text: string;
  sources: WebCitation[];
}

type Annotation = ResponseOutputText["annotations"][number];
type OutputItem = {
  type: string;
  status?: string;
  phase?: string | null;
  content?: { type: string; text?: string; annotations?: Annotation[] }[];
};

const MAX_FINDINGS = 3;
const MAX_SOURCES_PER_FINDING = 2;
const MAX_FINDING_CHARS = 380;

function findingText(line: string): string {
  // Drop parenthesized source links. Keep linked names when they form part of the sentence.
  const plain = line.replace(/\(\s*\[[^\]\n]*\]\(https?:\/\/[^\s)]+\)\s*\)/giu, "")
    .replace(/\[([^\]\n]*)\]\(https?:\/\/[^\s)]+\)/giu, "$1")
    .replace(/\uE200cite[^\uE201\n]*\uE201/gu, "")
    .replace(/【\d+(?:[:：]\d+)?†[^】\n]+】/gu, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "").replace(/\*\*/gu, "");
  return cleanErrandText(plain);
}

function lineSources(annotations: readonly Annotation[], start: number, end: number): WebCitation[] {
  const sources: WebCitation[] = [];
  for (const a of annotations) {
    if (a.type !== "url_citation" || !Number.isInteger(a.start_index) || !Number.isInteger(a.end_index) ||
        a.start_index < start || a.end_index > end || a.end_index <= a.start_index ||
        typeof a.url !== "string" || !isWebCitationUrl(a.url) || sources.some((s) => s.url === a.url)) continue;
    const title = typeof a.title === "string" ? cleanErrandText(a.title).slice(0, 160).trim() : "";
    sources.push({ title: title && title !== "[link]" ? title : new URL(a.url).hostname, url: a.url });
    if (sources.length === MAX_SOURCES_PER_FINDING) break;
  }
  return sources;
}

/** Undefined preserves the existing port contract for responses that did not use hosted search. */
export function citedSearchFindings(items: readonly OutputItem[]): SearchFinding[] | undefined {
  if (!items.some((item) => item.type === "web_search_call" && item.status === "completed")) return undefined;
  const findings: SearchFinding[] = [];
  for (const item of items) {
    if (item.type !== "message" || item.phase === "commentary" || (item.status && item.status !== "completed")) continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text" || !part.annotations?.length || !part.text || part.text.length > 16_384) continue;
      let start = 0;
      for (const line of part.text.split("\n")) {
        // The API offsets count characters. A non-BMP character is two UTF-16 code units in JS.
        const end = start + Array.from(line).length;
        const sources = lineSources(part.annotations, start, end);
        start = end + 1;
        if (!sources.length) continue;
        const text = findingText(line);
        // Never truncate a qualifier from a finding (e.g. a closing time or an exception to it).
        if (!text || text.length > MAX_FINDING_CHARS || findings.some((f) => f.text === text)) continue;
        findings.push({ text, sources });
        if (findings.length === MAX_FINDINGS) return findings;
      }
    }
  }
  return findings;
}
