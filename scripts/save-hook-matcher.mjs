// File-path matcher for the invariant save hook (R3.1, R3.4).
// Matches `.ts`/`.tsx` files under `packages/` or `apps/web/src/` whose directories are not `node_modules`, `.next`
// or `dist`. Built without lookaround, so it compiles in both JavaScript and Rust-style regex engines.

export const EXCLUDED_DIRS = ["node_modules", ".next", "dist"];

const SEP = "[\\\\/]";
const NOT_SEP = "[^\\\\/]";

const escape = (ch) => (/[.\\^$|?*+()[\]{}-]/.test(ch) ? `\\${ch}` : ch);
const notChars = (chars) => `[^\\\\/${chars.map(escape).join("")}]`;

/** A path segment (no separators) that is not exactly any word in `words`. */
export function segmentNotIn(words) {
  if (words.some((w) => w.length === 0)) throw new Error("excluded words must be non-empty");
  return `(?:${complement(words, 0)})`;
}

// Strings (one or more chars) that are not exactly any of `words`, given that `depth` leading characters already
// matched every word in `words`.
function complement(words, depth) {
  const parts = [];
  const firsts = [...new Set(words.filter((w) => w.length > depth).map((w) => w[depth]))];
  // Next char is none of the words' next chars: anything may follow.
  parts.push(`${notChars(firsts)}${NOT_SEP}*`);
  for (const ch of firsts) {
    const next = words.filter((w) => w[depth] === ch);
    const ended = next.filter((w) => w.length === depth + 1);
    const longer = next.filter((w) => w.length > depth + 1);
    // After `ch`: stopping here is allowed unless a word ends here. Continuing is allowed unless the rest is
    // exactly the remainder of a longer word.
    const tails = [];
    if (ended.length === 0) tails.push("");
    tails.push(longer.length > 0 ? complement(longer, depth + 1) : `${NOT_SEP}+`);
    parts.push(`${escape(ch)}(?:${tails.join("|")})`);
  }
  return parts.join("|");
}

export function saveHookMatcher() {
  const seg = segmentNotIn(EXCLUDED_DIRS);
  return `(?:^|${SEP})(?:packages|apps${SEP}web${SEP}src)${SEP}(?:${seg}${SEP})*${NOT_SEP}+\\.tsx?$`;
}
