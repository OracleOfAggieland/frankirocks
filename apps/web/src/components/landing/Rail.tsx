// The rail at the left edge: one terminal per section, each a link. The last terminal turns gold once the
// switch is thrown.
import { LANDING } from "../../ui/copy-landing";
import { FOCUS, TARGET } from "../surfaces/classes";

export function Rail({ won }: { won: boolean }) {
  return (
    <nav aria-label={LANDING.rail.label} data-rail="" data-won={won ? "true" : "false"} className="hidden">
      <ol>
        {LANDING.rail.terminals.map((t) => (
          <li key={t.id}>
            <a href={`#${t.id}`} data-terminal={t.id} className={`${TARGET} ${FOCUS} inline-flex items-center text-xs text-ink-dim`}>
              {t.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
