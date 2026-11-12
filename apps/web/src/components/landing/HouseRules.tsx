// House rules: six plaques, one per rule.
import { LANDING } from "../../ui/copy-landing";

export function HouseRules() {
  const { rules, sections } = LANDING;
  return (
    <section id="rules" aria-labelledby="rules-title" className="flex flex-col gap-6 py-24 text-left">
      <p className="font-mono text-xs text-brass">{sections.rules.eyebrow}</p>
      <h2 id="rules-title" className="font-display text-title text-ink">
        {sections.rules.title}
      </h2>
      <p className="max-w-[30rem] text-lg text-ink-dim">{sections.rules.body}</p>
      <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rules.map((rule, i) => (
          <li key={rule.id} data-rule={rule.id} className="mat-glass flex flex-col gap-2 rounded-card p-6">
            <span className="font-mono text-xs text-ink-dim">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="text-lg text-ink">{rule.title}</h3>
            <p className="text-base text-ink-dim">{rule.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
