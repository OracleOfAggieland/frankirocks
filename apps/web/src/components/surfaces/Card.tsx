// The Card (lab-ui-foundation R15.1 to R15.5, R16.1, R16.12). Props in, callbacks out. A one-line
// title, then the content, then sources, then actions. Every number is in mono tabular figures with
// its source tag. Renders nothing when its props have nothing true to show.
import { COPY } from "../../ui/copy";
import type { CardProps, HardRule, SourceTag } from "../../ui/surface-props";
import { BRASS_BUTTON, FOCUS, GLASS, QUIET_BUTTON, SOURCE_TAG, SOURCE_TAG_CHIP, TARGET } from "./classes";
import { Seal } from "./Seal";
import { Seam } from "./Seam";

const blank = (s: string) => s.trim() === "";

export interface SourceTagPlan {
  /** Per figure, in order: the tag shown right after it, or null when an earlier figure already cited that source. */
  figureTags: (SourceTag | null)[];
  /** The sources row: sources no figure has cited, each once. */
  row: SourceTag[];
}

/**
 * Pure (Brief 004 item 3). Each source appears at most once on a Card: inline after the first figure
 * that cites it, otherwise once in the sources row. A figure citing an ID missing from `sources` gets
 * a tag with the generic sources label.
 */
export function sourceTagPlan(p: CardProps): SourceTagPlan {
  const byId = new Map<string, SourceTag>();
  for (const s of p.sources) if (!byId.has(s.id)) byId.set(s.id, s);
  const shown = new Set<string>();
  const figureTags = (p.kind === "source" ? p.figures : []).map((f) => {
    if (shown.has(f.sourceId)) return null;
    shown.add(f.sourceId);
    return byId.get(f.sourceId) ?? { id: f.sourceId, label: COPY.card.sources };
  });
  const row = [...byId.values()].filter((s) => !shown.has(s.id));
  return { figureTags, row };
}

function SourceTagButton({ tag, onOpen, data }: { tag: SourceTag; onOpen: (id: string) => void; data: Record<`data-${string}`, string> }) {
  return (
    <button type="button" {...data} className={SOURCE_TAG} onClick={() => onOpen(tag.id)}>
      <span className={SOURCE_TAG_CHIP}>{tag.label}</span>
    </button>
  );
}

/** True when the props hold something to read or approve. */
export function cardHasContent(p: CardProps): boolean {
  if (blank(p.title)) return false;
  switch (p.kind) {
    case "source":
      return !blank(p.body) || p.figures.length > 0;
    case "approval":
      return !blank(p.effect);
    case "food":
      return !blank(p.choice);
    case "ask":
      return !blank(p.question) && p.options.length > 0;
    case "read":
      return p.lines.some((l) => !blank(l));
  }
}

/**
 * A hard rule the food was checked against: a locked line. The remove control exists only when the
 * caller passes `onRemoveRule` (R15.5), and it reads as removing the rule itself, never the dish or an
 * ingredient: a quiet text control, so the check reads first and removal stays a deliberate tap.
 */
function RuleLine({ rule, onRemove }: { rule: HardRule; onRemove?: (id: string) => void }) {
  return (
    <li data-rule={rule.id} className="flex min-h-8 items-center gap-2">
      <Seal />
      <span className="text-sm text-ink">{rule.text}</span>
      {onRemove ? (
        <button
          type="button"
          data-action="remove-rule"
          className={`${TARGET} ${FOCUS} ml-auto inline-flex items-center rounded-control px-2 text-sm text-ink-dim underline-offset-4 transition-colors duration-(--dur-quick) hover:text-ink hover:underline`}
          aria-label={COPY.card.removeRuleFor(rule.text, rule.person)}
          onClick={() => onRemove(rule.id)}
        >
          {COPY.card.removeRule}
        </button>
      ) : null}
    </li>
  );
}

function Content({ p, plan }: { p: CardProps; plan: SourceTagPlan }) {
  switch (p.kind) {
    case "source":
      return (
        <>
          {blank(p.body) ? null : <p className="text-base text-ink">{p.body}</p>}
          {p.figures.length > 0 ? (
            <dl className="mt-2 flex flex-col gap-1">
              {p.figures.map((f, i) => {
                const tag = plan.figureTags[i];
                return (
                  <div key={`${f.label}-${f.sourceId}`} data-figure="" className="flex flex-wrap items-center gap-x-2">
                    <dt className="text-sm text-ink-dim">{f.label}</dt>
                    <dd className="inline-flex flex-wrap items-center gap-x-1">
                      <span className="font-mono text-lg text-ink">{f.value}</span>
                      {tag ? <SourceTagButton tag={tag} onOpen={p.onOpenSource} data={{ "data-figure-source": tag.id }} /> : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : null}
        </>
      );
    case "approval":
      return <p className="text-base text-ink">{p.effect}</p>;
    case "food":
      return (
        <>
          <p className="text-base text-ink">{p.choice}</p>
          {p.ingredients.length > 0 ? (
            <p className="mt-1 text-sm text-ink-dim">
              {COPY.card.ingredients}: {p.ingredients.join(", ")}
            </p>
          ) : null}
          {p.checkedFor.map((c) => (
            <div key={c.person} data-checked-for={c.person} className="mt-2">
              <p className="text-sm text-ink-dim">
                {COPY.card.checkedFor} {c.person}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {c.rules.map((r) => (
                  <RuleLine key={r.id} rule={r} onRemove={p.onRemoveRule} />
                ))}
              </ul>
            </div>
          ))}
        </>
      );
    case "ask":
      return <p className="text-base text-ink">{p.question}</p>;
    case "read":
      return (
        <ul className="flex flex-col gap-1">
          {p.lines.filter((l) => !blank(l)).map((l, i) => (
            <li key={i} className="text-base text-ink">
              {l}
            </li>
          ))}
        </ul>
      );
  }
}

function Actions(p: CardProps) {
  if (p.kind === "approval") {
    return (
      <>
        <button type="button" data-action="yes" className={BRASS_BUTTON} onClick={p.onYes}>
          {COPY.card.yes}
        </button>
        <button type="button" data-action="not-now" className={QUIET_BUTTON} onClick={p.onNotNow}>
          {COPY.card.notNow}
        </button>
      </>
    );
  }
  if (p.kind === "ask") {
    return (
      <>
        {p.options.map((o) => (
          <button key={o.id} type="button" data-action={`answer-${o.id}`} className={QUIET_BUTTON} onClick={() => p.onAnswer(o.id)}>
            {o.label}
          </button>
        ))}
      </>
    );
  }
  return null;
}

export function Card(props: CardProps) {
  if (!cardHasContent(props)) return null;
  const actions = Actions(props);
  const plan = sourceTagPlan(props);
  return (
    <article data-card={props.kind} aria-label={props.title} className={`${GLASS} flex w-full max-w-[343px] flex-col gap-3 p-4 text-left`}>
      <Seam />
      <h2 data-section="title" className="truncate text-lg text-ink">
        {props.title}
      </h2>
      <div data-section="content">
        <Content p={props} plan={plan} />
      </div>
      {plan.row.length > 0 ? (
        <div data-section="sources" className="flex flex-wrap gap-x-1">
          {plan.row.map((s) => (
            <SourceTagButton key={s.id} tag={s} onOpen={props.onOpenSource} data={{ "data-source": s.id }} />
          ))}
        </div>
      ) : null}
      {actions !== null ? (
        <div data-section="actions" className="flex flex-wrap gap-2">
          {actions}
        </div>
      ) : null}
    </article>
  );
}
