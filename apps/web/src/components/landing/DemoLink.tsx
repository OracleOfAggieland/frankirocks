"use client";
// The front door's Kiroween Demo button (brief 054, R1.1, R1.3, R1.7): a plain link to the Lab's demo marker. It
// starts no sign-in itself, so the front door holds no Firebase code; the Lab signs in when it finds the marker. It
// renders nothing until the switch has answered on, so a demo that is off leaves no trace, and nothing shows
// while the answer is out.
import { useEffect, useState } from "react";
import { DEMO_HREF, fetchDemoEnabled } from "../../client/demo";
import { LANDING } from "../../ui/copy-landing";
import { FOCUS, TARGET } from "../surfaces/classes";
import { BoltGlyph } from "./TopBar";

export const DEMO_LINK_CLASS = `${TARGET} ${FOCUS} mat-brass inline-flex min-h-12 items-center gap-2 rounded-control px-6 text-base font-medium transition-transform duration-(--dur-quick) ease-ecto active:translate-y-0.5`;

/** The link itself, shown once the switch is known to be on. Exported for the specimens and tests. */
export function DemoLinkView({ enabled }: { enabled: boolean | null }) {
  if (enabled !== true) return null;
  return (
    <a href={DEMO_HREF} data-demo-link="" className={DEMO_LINK_CLASS}>
      <BoltGlyph className="size-4" />
      {LANDING.hero.demo}
    </a>
  );
}

export function DemoLink({ read = fetchDemoEnabled }: { read?: typeof fetchDemoEnabled }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void read((input, init) => fetch(input, init)).then((on) => {
      if (live) setEnabled(on);
    });
    return () => {
      live = false;
    };
  }, [read]);
  return <DemoLinkView enabled={enabled} />;
}
