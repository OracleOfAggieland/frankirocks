// Source rows (brief 015, UI direction "Source rows"): the rows behind a source tag, opened inside its card.
// A real table in mono with a caption for screen readers, headed When, What, Amount, with a total row. Rows
// materialize one after another on STAGGER (cards.css); under reduced motion they fade in together.
// The total is added up here only when every amount is a plain figure with the same prefix ("$30", "$1,204.50");
// otherwise there is no total row, so the card never shows a number it cannot trace.
import type { CSSProperties } from "react";
import { COPY } from "../../ui/copy";
import { FOCUS } from "./classes";

export interface SourceRow {
  id: string;
  when: string;
  what: string;
  amount: string;
}

interface Parsed {
  negative: boolean;
  prefix: string;
  /** The amount in units of 10^-decimals. */
  units: bigint;
  decimals: number;
}

/** "-$1,204.50" → sign, prefix "$", digits. Grouping commas must be well formed; no suffix is allowed. */
const AMOUNT = /^([-−]?)([^\d\s.,\-−]*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;

function parseAmount(text: string): Parsed | null {
  const m = AMOUNT.exec(text.trim());
  if (m === null) return null;
  const [, sign, prefix, whole, fraction = ""] = m;
  return { negative: sign !== "", prefix, units: BigInt(whole.replace(/,/g, "") + fraction), decimals: fraction.length };
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Pure. The sum of the rows' amounts, written the way the rows write them: the same prefix, grouping commas,
 * and as many decimals as the most precise row. Null when there are no rows, when any amount is not a plain
 * figure, or when the prefixes differ.
 */
export function totalOf(rows: readonly Pick<SourceRow, "amount">[]): string | null {
  if (rows.length === 0) return null;
  const parsed = rows.map((r) => parseAmount(r.amount));
  if (parsed.some((p) => p === null)) return null;
  const all = parsed as Parsed[];
  const prefix = all[0].prefix;
  if (all.some((p) => p.prefix !== prefix)) return null;
  const decimals = Math.max(...all.map((p) => p.decimals));
  let sum = BigInt(0);
  for (const p of all) {
    const scaled = p.units * BigInt(10) ** BigInt(decimals - p.decimals);
    sum += p.negative ? -scaled : scaled;
  }
  const negative = sum < BigInt(0);
  const digits = (negative ? -sum : sum).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : "";
  return `${negative ? "-" : ""}${prefix}${group(whole)}${fraction}`;
}

const CELL = "px-3 py-1.5 align-baseline";

/**
 * The rows' box. Its height is capped (lower below 1024 px, where the dock is a bottom sheet) and the rows
 * scroll inside it, so open rows never push the card past the room the screen keeps for it. The box can take
 * keyboard focus so the rows can be scrolled without a pointer.
 */
export const ROWS_BOX = `${FOCUS} max-h-40 w-full overflow-y-auto overscroll-contain rounded-control border border-ink/10 bg-night-0/50 lg:max-h-72`;
/** The header cells stay at the top while the rows scroll under them. */
const HEAD_CELL = `${CELL} sticky top-0 z-1 bg-night-0 font-normal`;

export interface SourceRowsProps {
  /** The element ID the opening source tag points at with aria-controls. */
  id?: string;
  /** The source's label ("Bank · 6 purchases"), read with the caption. */
  label: string;
  rows: readonly SourceRow[];
}

export function SourceRows({ id, label, rows }: SourceRowsProps) {
  if (rows.length === 0) return null;
  const total = totalOf(rows);
  const name = `${COPY.card.rows}: ${label}`;
  return (
    <div id={id} data-source-rows="" role="region" aria-label={name} tabIndex={0} className={ROWS_BOX}>
      <table className="w-full border-collapse font-mono text-xs text-ink">
        <caption className="sr-only">{name}</caption>
        <thead>
          <tr className="text-ink-dim">
            <th scope="col" className={`${HEAD_CELL} text-left`}>
              {COPY.card.when}
            </th>
            <th scope="col" className={`${HEAD_CELL} w-full text-left`}>
              {COPY.card.what}
            </th>
            <th scope="col" className={`${HEAD_CELL} text-right`}>
              {COPY.card.amount}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} data-row={r.id} className="franki-row border-t border-ink/5" style={{ "--row": i } as CSSProperties}>
              <td className={`${CELL} whitespace-nowrap text-ink-dim`}>{r.when}</td>
              <td className={`${CELL} break-words`}>{r.what}</td>
              <td className={`${CELL} whitespace-nowrap text-right`}>{r.amount}</td>
            </tr>
          ))}
        </tbody>
        {total !== null ? (
          <tfoot>
            <tr data-row="total" className="franki-row border-t border-dashed border-stitch" style={{ "--row": rows.length } as CSSProperties}>
              <th scope="row" colSpan={2} className={`${CELL} text-left font-normal text-ink-dim`}>
                {COPY.card.total}
              </th>
              <td className={`${CELL} whitespace-nowrap text-right text-ink`}>{total}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
