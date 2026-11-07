// The What_I_Know_Sheet (lab-ui-foundation R16.1, R16.4, R16.12). Hard rules first under their seal,
// then the five areas in order. Each item shows its text, where it came from, and Wrong, Forget and
// Don't bring it up. Guesses are labelled "Guessed" with a dashed outline. Renders nothing when empty.
import { COPY } from "../../ui/copy";
import type { KnownItem, WhatIKnowProps } from "../../ui/surface-props";
import { GLASS, QUIET_BUTTON } from "./classes";
import { Seal } from "./Seal";

function Item({ item, onWrong, onForget, onQuiet }: { item: KnownItem } & Pick<WhatIKnowProps, "onWrong" | "onForget" | "onQuiet">) {
  return (
    <li
      data-item={item.id}
      data-guessed={item.guessed ? "true" : "false"}
      className={`flex flex-col gap-2 rounded-control p-3 ${item.guessed ? "border border-dashed border-ink-dim" : "border border-transparent bg-night-1"}`}
    >
      <div className="flex items-start gap-2">
        {item.hardRule ? <Seal /> : null}
        <p className="text-base text-ink">{item.text}</p>
        {item.guessed ? <span className="ml-auto shrink-0 text-xs text-ink-dim">{COPY.sheet.guessed}</span> : null}
      </div>
      <p className="font-mono text-xs text-ink-dim">
        {COPY.sheet.from} {item.from}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-action="wrong" className={`${QUIET_BUTTON} text-sm`} onClick={() => onWrong(item.id)}>
          {COPY.sheet.wrong}
        </button>
        <button type="button" data-action="forget" className={`${QUIET_BUTTON} text-sm`} onClick={() => onForget(item.id)}>
          {COPY.sheet.forget}
        </button>
        <button type="button" data-action="quiet" className={`${QUIET_BUTTON} text-sm`} onClick={() => onQuiet(item.id)}>
          {COPY.sheet.quiet}
        </button>
      </div>
    </li>
  );
}

export function WhatIKnowSheet({ items, onWrong, onForget, onQuiet, onClose }: WhatIKnowProps) {
  if (items.length === 0) return null;
  const rules = items.filter((i) => i.hardRule);
  const groups = COPY.areas.map((area) => ({ area, items: items.filter((i) => !i.hardRule && i.area === area) })).filter((g) => g.items.length > 0);
  const actions = { onWrong, onForget, onQuiet };
  return (
    <section role="dialog" aria-label={COPY.sheet.title} data-sheet="" className={`${GLASS} flex w-full max-w-[343px] flex-col gap-4 p-4 text-left sm:max-w-md`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg text-ink">{COPY.sheet.title}</h2>
        <button type="button" className={`${QUIET_BUTTON} text-sm`} onClick={onClose}>
          {COPY.sheet.close}
        </button>
      </div>
      {rules.length > 0 ? (
        <div data-group="rules">
          <h3 className="mb-2 flex items-center gap-2 text-sm text-brass">
            <Seal />
            {COPY.sheet.hardRules}
          </h3>
          <ul className="flex flex-col gap-2">
            {rules.map((i) => (
              <Item key={i.id} item={i} {...actions} />
            ))}
          </ul>
        </div>
      ) : null}
      {groups.map((g) => (
        <div key={g.area} data-group={g.area}>
          <h3 className="mb-2 text-sm text-ink-dim">{g.area}</h3>
          <ul className="flex flex-col gap-2">
            {g.items.map((i) => (
              <Item key={i.id} item={i} {...actions} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
