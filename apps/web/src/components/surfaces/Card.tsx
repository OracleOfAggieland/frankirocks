"use client";
// The Card (lab-ui-foundation R15.1 to R15.5, R16.1, R16.12; brief 015). Props in, callbacks out. A one-line
// title with the card kind's line glyph, then the content, then sources, then actions. Every number is in mono
// tabular figures with its source tag. Renders nothing when its props have nothing true to show.
// Glass with the stitched seam on top. An approval card is riveted at its four corners and its Yes is brass.
// The card lifts 2 px under a hovering pointer on spring.press (cards.css).
// A read card given `onClose` offers Close among its actions; without it the card has none.
// With `sourceRows`, tapping a source tag that has rows opens them inside the card (tapping it again closes
// them), and the tap still calls onOpenSource. With `openSource` the host holds which source is open instead.
import { type ReactNode, useState } from "react";
import { isWebCitationUrl } from "@franki/core";
import { COPY } from "../../ui/copy";
import type { CardKind, CardProps, HardRule, SourceTag } from "../../ui/surface-props";
import { Rivet } from "../lab/Rivet";
import { FOCUS, QUIET_BUTTON, SOURCE_TAG, SOURCE_TAG_CHIP, TARGET } from "./classes";
import { Seal } from "./Seal";
import { Seam } from "./Seam";
import { type SourceRow, SourceRows } from "./SourceRows";

const blank = (s: string) => s.trim() === "";

/** Rows behind each source, by source ID. */
export type SourceRowsBySource = Readonly<Record<string, readonly SourceRow[]>>;

export interface CardExtras {
  /** The rows behind each source tag, by source ID. A tag opens rows only when its source has some. */
  sourceRows?: SourceRowsBySource;
  /** The source whose rows show when the card first renders (a specimen, or a demonstration). */
  defaultOpenSource?: string | null;
  /**
   * The open source, held by the host. When given (even as null) the card keeps no open state of its own: a tap
   * on a tag only calls onOpenSource, and the host moves this on (with `nextOpenSource`, say).
   */
  openSource?: string | null;
}

export type CardViewProps = CardProps & CardExtras;

/** Brass, primary, for an approval's Yes: the brass material, depressing 2 px on press. */
const YES_BUTTON = `${TARGET} ${FOCUS} franki-card-press mat-brass inline-flex items-center justify-center rounded-control px-5 text-base font-medium disabled:opacity-40`;

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

/** Pure. True when this source has rows to open. */
export function hasRows(rows: SourceRowsBySource | undefined, id: string | null | undefined): id is string {
  return id != null && rows !== undefined && (rows[id]?.length ?? 0) > 0;
}

/**
 * Pure. Which source's rows show after a tap on `tapped`'s tag: a tag with rows opens them, or closes them when
 * they are already open; a tag without rows leaves the card as it was.
 */
export function nextOpenSource(open: string | null, tapped: string, rows: SourceRowsBySource | undefined): string | null {
  if (!hasRows(rows, tapped)) return open;
  return open === tapped ? null : tapped;
}

/**
 * The tap on a source tag, for a card with rows: moves the open source on by `nextOpenSource` through `update`
 * (a state setter) and calls onOpenSource once, whether or not that source has rows.
 */
export function tagTapHandler(
  update: (next: (open: string | null) => string | null) => void,
  rows: SourceRowsBySource,
  onOpenSource: (id: string) => void,
): (id: string) => void {
  return (id) => {
    update((open) => nextOpenSource(open, id, rows));
    onOpenSource(id);
  };
}

/** The element ID of a card's rows for one source. */
export function rowsElementId(cardId: string, sourceId: string): string {
  return `${cardId}-rows-${sourceId}`.replace(/[^\w-]/g, "_");
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
 * The 16 px line glyph for each kind, drawn on a 16-unit grid in a 1.5 stroke with round ends:
 * source, two binding posts joined by a wire; approval, a toggle switch waiting at off; food, a fork;
 * ask, a question mark in a ring; read, three lines of text.
 */
const GLYPHS: Record<CardKind, ReactNode> = {
  source: (
    <>
      <circle cx="3.5" cy="8" r="2.25" />
      <circle cx="12.5" cy="8" r="2.25" />
      <path d="M5.75 8 H10.25" />
      <circle cx="3.5" cy="8" r="0.55" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="0.55" fill="currentColor" stroke="none" />
    </>
  ),
  approval: (
    <>
      <rect x="1.25" y="4.25" width="13.5" height="7.5" rx="3.75" />
      <circle cx="5" cy="8" r="2" />
    </>
  ),
  food: <path d="M5.25 1.5 V5.25 M8 1.5 V5.25 M10.75 1.5 V5.25 M5.25 5.25 C5.25 7.4 6.3 8.25 8 8.25 C9.7 8.25 10.75 7.4 10.75 5.25 M8 8.25 V14.5" />,
  ask: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6.1 6.25 C6.1 5.1 7 4.4 8 4.4 C9.1 4.4 9.95 5.15 9.95 6.15 C9.95 7.05 9.35 7.45 8.7 7.85 C8.2 8.15 8 8.5 8 9.1 V9.4" />
      <circle cx="8" cy="11.5" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  read: <path d="M3 4.5 H13 M3 8 H13 M3 11.5 H9.5" />,
};

/** The line glyph beside a card's title. Decorative: the title names the card. */
export function KindGlyph({ kind, className = "" }: { kind: CardKind; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      data-glyph={kind}
      className={`pointer-events-none shrink-0 ${className}`.trim()}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {GLYPHS[kind]}
    </svg>
  );
}

interface TagState {
  rows: SourceRowsBySource | undefined;
  open: string | null;
  cardId: string;
  onTag: (id: string) => void;
}

function SourceTagButton({ tag, tags, data }: { tag: SourceTag; tags: TagState; data: Record<`data-${string}`, string> }) {
  const opens = hasRows(tags.rows, tag.id);
  return (
    <button
      type="button"
      {...data}
      {...(opens ? { "aria-expanded": tags.open === tag.id, "aria-controls": rowsElementId(tags.cardId, tag.id) } : {})}
      className={SOURCE_TAG}
      onClick={() => tags.onTag(tag.id)}
    >
      <span className={SOURCE_TAG_CHIP}>{tag.label}</span>
    </button>
  );
}

/** The rows for one source, when that source is the open one. */
function OpenRows({ tag, tags }: { tag: SourceTag; tags: TagState }) {
  if (tags.open !== tag.id || !hasRows(tags.rows, tag.id)) return null;
  return (
    <div data-section="rows" className="mt-2 w-full basis-full">
      <SourceRows id={rowsElementId(tags.cardId, tag.id)} label={tag.label} rows={tags.rows?.[tag.id] ?? []} />
    </div>
  );
}

/**
 * A hard rule the food was checked against: a locked line, read-only (R15.5). A Card never offers to
 * remove a hard rule; that happens only in the What_I_Know_Sheet, where the person manages rules on purpose.
 */
function RuleLine({ rule }: { rule: HardRule }) {
  return (
    <li data-rule={rule.id} className="flex min-h-8 items-center gap-2">
      <Seal />
      <span className="text-sm text-ink">{rule.text}</span>
    </li>
  );
}

function Content({ p, plan, tags }: { p: CardProps; plan: SourceTagPlan; tags: TagState }) {
  switch (p.kind) {
    case "source":
      return (
        <>
          {blank(p.body) ? null : <p className="text-base text-ink">{p.body}</p>}
          {p.figures.length > 0 ? (
            <dl className="mt-3 flex flex-col gap-3">
              {p.figures.map((f, i) => {
                const tag = plan.figureTags[i];
                return (
                  <div key={`${f.label}-${f.sourceId}`} data-figure="" className="flex flex-col">
                    <dt className="font-mono text-xs tracking-[0.04em] text-ink-dim">{f.label}</dt>
                    <dd className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-2xl leading-tight text-ink">{f.value}</span>
                      {tag ? <SourceTagButton tag={tag} tags={tags} data={{ "data-figure-source": tag.id }} /> : null}
                      {tag ? <OpenRows tag={tag} tags={tags} /> : null}
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
            <div key={c.person} data-checked-for={c.person} className="mt-3">
              <p className="text-sm text-ink-dim">
                {COPY.card.checkedFor} {c.person}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {c.rules.map((r) => (
                  <RuleLine key={r.id} rule={r} />
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
        <ul className="flex flex-col gap-1.5">
          {p.lines.map((l, i) => !blank(l) && (
            <li key={i} className="flex items-baseline gap-2.5 text-base text-ink">
              <span aria-hidden="true" className="pointer-events-none inline-block size-1 shrink-0 -translate-y-0.5 rounded-full bg-ink-dim" />
              <span className="min-w-0">{l}{p.citationsByLine?.[i]?.map(({ title, url }) => isWebCitationUrl(url) && (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer" className={`${FOCUS} block break-words text-sm text-brass underline underline-offset-2`}>{title}</a>
              ))}</span>
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
        <button type="button" data-action="yes" className={YES_BUTTON} onClick={p.onYes}>
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
  if (p.kind === "read" && p.onClose !== undefined) {
    return (
      <button type="button" data-action="close" className={QUIET_BUTTON} onClick={p.onClose}>
        {COPY.card.close}
      </button>
    );
  }
  return null;
}

/** Four rivets, one in each corner, 10 px in. */
function CornerRivets() {
  return (
    <>
      <Rivet className="absolute top-2.5 left-2.5" />
      <Rivet className="absolute top-2.5 right-2.5" />
      <Rivet className="absolute bottom-2.5 left-2.5" />
      <Rivet className="absolute right-2.5 bottom-2.5" />
    </>
  );
}

/** The card as drawn, for a given open source. No state of its own. */
function CardFace({ p, tags }: { p: CardViewProps; tags: TagState }) {
  const actions = Actions(p);
  const plan = sourceTagPlan(p);
  const rowTag = plan.row.find((s) => s.id === tags.open);
  return (
    <article
      data-card={p.kind}
      aria-label={p.title}
      className="franki-card mat-glass relative flex w-full max-w-[343px] flex-col gap-3 rounded-card p-4 text-left"
    >
      {p.kind === "approval" ? <CornerRivets /> : null}
      <Seam />
      <h2 data-section="title" className="flex min-w-0 items-center gap-2 text-lg text-ink">
        <KindGlyph kind={p.kind} className="text-ink-dim" />
        <span className="min-w-0 truncate">{p.title}</span>
      </h2>
      <div data-section="content" className={p.kind === "read" && p.citationsByLine ? "max-h-[42dvh] overflow-y-auto" : undefined}>
        <Content p={p} plan={plan} tags={tags} />
      </div>
      {plan.row.length > 0 ? (
        <div data-section="sources" className="flex flex-wrap gap-x-1">
          {plan.row.map((s) => (
            <SourceTagButton key={s.id} tag={s} tags={tags} data={{ "data-source": s.id }} />
          ))}
          {rowTag ? <OpenRows tag={rowTag} tags={tags} /> : null}
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

/** A card whose source tags open rows: holds which source is open. */
function CardWithRows(props: CardViewProps & { sourceRows: SourceRowsBySource }) {
  const { sourceRows, defaultOpenSource = null, onOpenSource } = props;
  const [open, setOpen] = useState<string | null>(hasRows(sourceRows, defaultOpenSource) ? defaultOpenSource : null);
  const onTag = tagTapHandler(setOpen, sourceRows, onOpenSource);
  const shown = hasRows(sourceRows, open) ? open : null;
  return <CardFace p={props} tags={{ rows: sourceRows, open: shown, cardId: props.id, onTag }} />;
}

export function Card(props: CardViewProps) {
  if (!cardHasContent(props)) return null;
  if (props.sourceRows === undefined) {
    return <CardFace p={props} tags={{ rows: undefined, open: null, cardId: props.id, onTag: props.onOpenSource }} />;
  }
  if (props.openSource !== undefined) {
    const shown = hasRows(props.sourceRows, props.openSource) ? props.openSource : null;
    return <CardFace p={props} tags={{ rows: props.sourceRows, open: shown, cardId: props.id, onTag: props.onOpenSource }} />;
  }
  return <CardWithRows {...props} sourceRows={props.sourceRows} />;
}
