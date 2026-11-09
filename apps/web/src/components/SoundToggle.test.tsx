import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StorageLike } from "../ui/sound/preference";
import { SoundPreference, SoundToggle, SoundToggleView } from "./SoundToggle";

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("SoundToggle", () => {
  it("is one button named Sound effects with aria-pressed and a 44 px target", () => {
    const html = renderToStaticMarkup(<SoundToggle preference={new SoundPreference(memory())} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Sound effects"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("min-h-11 min-w-11");
  });

  it("toggling writes the preference", () => {
    const storage = memory();
    const pref = new SoundPreference(storage);
    expect(pref.getSnapshot()).toBe(true);
    const tree = SoundToggleView({ on: pref.getSnapshot(), onToggle: () => pref.set(!pref.getSnapshot()) }) as { props: { onClick: () => void } };
    tree.props.onClick();
    expect(pref.getSnapshot()).toBe(false);
    expect(storage.data.get("franki.sound")).toBe("off");
    expect(new SoundPreference(storage).getSnapshot()).toBe(false);
  });
});
