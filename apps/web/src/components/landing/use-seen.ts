"use client";
// Which parts of a section have entered view, once each (brief 015, package I). Every descendant of the
// returned ref with a `data-seen-key` is watched by one IntersectionObserver. On the server, and until the
// observer first reports, every key is "static": drawn in full, so the page reads with scripting off. Each
// report goes through nextSeen (ui/landing/seen.ts), which decides "waiting" or "seen"; a seen key is no
// longer watched.
import { useEffect, useRef, useState } from "react";
import { type Seen, nextSeen } from "../../ui/landing/seen";

export type { Seen };

export function useSeen<T extends HTMLElement>(threshold = 0.25) {
  const root = useRef<T | null>(null);
  const [phases, setPhases] = useState<Readonly<Record<string, Seen>>>({});

  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    const targets = [...el.querySelectorAll<HTMLElement>("[data-seen-key]")];
    const keyOf = (t: Element) => (t as HTMLElement).dataset.seenKey ?? "";
    if (typeof IntersectionObserver === "undefined") {
      // No observer: show everything at once, told after the commit like any external answer.
      let live = true;
      void Promise.resolve().then(() => {
        if (live) setPhases(Object.fromEntries(targets.map((t) => [keyOf(t), "seen" as const])));
      });
      return () => {
        live = false;
      };
    }
    const known = new Map<Element, Seen>();
    const io = new IntersectionObserver(
      (entries) => {
        const next: Record<string, Seen> = {};
        for (const e of entries) {
          const prev = known.get(e.target);
          const now = nextSeen(prev, { first: prev === undefined, isIntersecting: e.isIntersecting, ratio: e.intersectionRatio }, threshold);
          known.set(e.target, now);
          if (now !== prev) next[keyOf(e.target)] = now;
          if (now === "seen") io.unobserve(e.target);
        }
        if (Object.keys(next).length > 0) setPhases((p) => ({ ...p, ...next }));
      },
      { threshold: [0, threshold] },
    );
    for (const t of targets) io.observe(t);
    return () => io.disconnect();
  }, [threshold]);

  const phase = (key: string): Seen => phases[key] ?? "static";
  return { root, phase } as const;
}
