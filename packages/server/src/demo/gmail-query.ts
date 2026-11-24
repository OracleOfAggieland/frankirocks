/**
 * The Gmail search forms the simulated Google reads (brief 054, R9.3). Exactly the forms the product writes: the
 * mail agent's query from `gmailQuery` (packages/core/src/google) and the trust check's `in:sent to:<address>`
 * (`ownerHasMailed`). Terms are separated by one space and all must hold.
 *
 * Anything else, a form or a spacing the product does not write, does not parse, and the port refuses the call. That
 * fails closed: if the product starts writing a new form, the simulator refuses it and property 16 goes red, instead
 * of the simulator quietly answering a looser search than Gmail would.
 */
import type { SimMessage } from "./sim-google";

export type QueryTerm =
  | { neg: boolean; op: "from" | "to" | "in" | "category" | "is" | "word"; value: string }
  | { neg: boolean; op: "after" | "before"; seconds: number };

/** The exclusions `gmailQuery` always adds, as labels a message must not carry. */
const EXCLUDED: Readonly<Record<string, { op: "in" | "category"; value: string; label: string }>> = {
  "-in:spam": { op: "in", value: "spam", label: "SPAM" },
  "-in:trash": { op: "in", value: "trash", label: "TRASH" },
  "-category:promotions": { op: "category", value: "promotions", label: "CATEGORY_PROMOTIONS" },
  "-category:social": { op: "category", value: "social", label: "CATEGORY_SOCIAL" },
};

/** A quoted term as `quotedTerm` writes it: no quote inside, nothing empty. */
const QUOTED = /^"([^"]+)"/;
const FROM_QUOTED = /^from:"([^"]+)"/;
const TIME = /^(after|before):(\d{1,15})(?= |$)/;
/** An address as `ownerHasMailed` sends it: cleaned and lower-cased, no space and no quote. */
const TO = /^to:([^\s"():]{1,64}@[^\s"():]{1,253})(?= |$)/;
const BARE = /^(\S+)(?= |$)/;

/** The terms of a query, or null when any part of it is not a form the product writes. */
export function parseGmailQuery(q: string): QueryTerm[] | null {
  if (q === "" || q.length > 1024) return null;
  const terms: QueryTerm[] = [];
  let rest = q;
  for (;;) {
    let m: RegExpExecArray | null;
    if ((m = FROM_QUOTED.exec(rest)) !== null) terms.push({ neg: false, op: "from", value: m[1]! });
    else if ((m = QUOTED.exec(rest)) !== null) terms.push({ neg: false, op: "word", value: m[1]! });
    else if ((m = TIME.exec(rest)) !== null) terms.push({ neg: false, op: m[1] as "after" | "before", seconds: Number(m[2]) });
    else if ((m = TO.exec(rest)) !== null) terms.push({ neg: false, op: "to", value: m[1]!.toLowerCase() });
    else if ((m = BARE.exec(rest)) !== null) {
      const word = m[1]!;
      const ex = EXCLUDED[word];
      if (ex !== undefined) terms.push({ neg: true, op: ex.op, value: ex.value });
      else if (word === "is:unread") terms.push({ neg: false, op: "is", value: "unread" });
      else if (word === "in:sent") terms.push({ neg: false, op: "in", value: "sent" });
      else return null;
    } else return null;
    rest = rest.slice(m[0].length);
    if (rest === "") return terms;
    // Exactly one space between terms, and never a trailing one.
    if (rest[0] !== " " || rest.length === 1 || rest[1] === " ") return null;
    rest = rest.slice(1);
  }
}

const LABEL_OF: Readonly<Record<string, string>> = { sent: "SENT", spam: "SPAM", trash: "TRASH", promotions: "CATEGORY_PROMOTIONS", social: "CATEGORY_SOCIAL", unread: "UNREAD" };

/** The From as the matcher reads it: the line's own name and address, whatever quoting the header needed. */
const fromText = (m: SimMessage) => `${m.line.from.name} <${m.line.from.address}>`.toLowerCase();

function holds(m: SimMessage, t: QueryTerm): boolean {
  switch (t.op) {
    case "after":
      return m.internalDate >= t.seconds * 1000;
    case "before":
      return m.internalDate < t.seconds * 1000;
    case "from":
      return fromText(m).includes(t.value.toLowerCase());
    case "word": {
      const w = t.value.toLowerCase();
      return [m.line.subject, m.line.body].some((s) => s.toLowerCase().includes(w)) || fromText(m).includes(w);
    }
    case "to":
      // The To and Cc headers carry the line's `to`; Gmail's `to:` reads both.
      return m.line.to.some((a) => a.trim().toLowerCase() === t.value);
    case "in":
    case "category":
    case "is": {
      const label = LABEL_OF[t.value];
      return label !== undefined && m.labelIds.includes(label);
    }
  }
}

/** Whether a message answers every term. */
export function matchesQuery(m: SimMessage, terms: readonly QueryTerm[]): boolean {
  return terms.every((t) => holds(m, t) !== t.neg);
}
