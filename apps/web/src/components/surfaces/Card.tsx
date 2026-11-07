// The Card (lab-ui-foundation R15.1 to R15.5, R16.1, R16.12). Props in, callbacks out. A one-line
// title, then the content, then sources, then actions. Every number is in mono tabular figures with
// its source tag. Renders nothing when its props have nothing true to show.
import { COPY } from "../../ui/copy";
import type { CardProps, HardRule } from "../../ui/surface-props";
import { BRASS_BUTTON, GLASS, QUIET_BUTTON, SOURCE_TAG } from "./classes";
import { Seal } from "./Seal";
import { Seam } from "./Seam";

const blank = (s: string) => s.trim() === "";

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

function RuleLine({ rule, onRemove }: { rule: HardRule; onRemove?: (id: string) => void }) {
  return (
    <li data-rule={rule.id} className="flex items-center gap-2">
      <Seal />
      <span className="text-sm text-ink">{rule.text}</span>
      {onRemove ? (
        <button type="button" className={`${QUIET_BUTTON} ml-auto text-sm`} aria-label={`${COPY.card.remove}: ${rule.text}`} onClick={() => onRemove(rule.id)}>
          {COPY.card.remove}
        </button>
      ) : null}
    </li>
  );
}

function Content(p: CardProps) {
  switch (p.kind) {
    case "source":
      return (
        <>
          {blank(p.body) ? null : <p className="text-base text-ink">{p.body}</p>}
          {p.figures.length > 0 ? (
            <dl className="mt-2 flex flex-col gap-2">
              {p.figures.map((f) => (
                <div key={`${f.label}-${f.sourceId}`} className="flex flex-wrap items-center gap-2">
                  <dt className="text-sm text-ink-dim">{f.label}</dt>
                  <dd className="font-mono text-lg text-ink">{f.value}</dd>
                  <button type="button" data-figure-source={f.sourceId} className={SOURCE_TAG} onClick={() => p.onOpenSource(f.sourceId)}>
                    {p.sources.find((s) => s.id === f.sourceId)?.label ?? COPY.card.sources}
                  </button>
                </div>
              ))}
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
  return (
    <article data-card={props.kind} aria-label={props.title} className={`${GLASS} flex w-full max-w-[343px] flex-col gap-3 p-4 text-left`}>
      <Seam />
      <h2 data-section="title" className="truncate text-lg text-ink">
        {props.title}
      </h2>
      <div data-section="content">
        <Content {...props} />
      </div>
      {props.sources.length > 0 ? (
        <div data-section="sources" className="flex flex-wrap gap-2">
          {props.sources.map((s) => (
            <button key={s.id} type="button" data-source={s.id} className={SOURCE_TAG} onClick={() => props.onOpenSource(s.id)}>
              {s.label}
            </button>
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
