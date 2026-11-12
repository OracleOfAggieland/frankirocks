import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AVATAR_LABELS } from "../../ui/copy";
import { planVoice } from "../../ui/landing/demo-voice";
import { DemoAvatar } from "./DemoAvatar";

const LISTEN = { state: "listening" as const, micMuted: false, event: null, speaking: false };

describe("Franki on the front door", () => {
  it("renders one avatar, asleep, on the server, whatever the scene asks for", () => {
    const html = renderToStaticMarkup(<DemoAvatar franki={{ ...LISTEN, state: "speaking", speaking: true }} speech={planVoice("Hello there.")} reduced={false} />);
    expect(html.match(/role="img"/g)).toHaveLength(1);
    expect(html).toContain(`aria-label="${AVATAR_LABELS.closed}"`);
    expect(html).toContain('data-look="Dormant"');
    expect(html).toContain('data-three-phase="svg"');
    expect(html).not.toContain("<canvas");
  });

  it("draws its halo and floor as decoration, floating only when motion is allowed", () => {
    const moving = renderToStaticMarkup(<DemoAvatar franki={LISTEN} speech={null} reduced={false} />);
    expect(moving).toMatch(/aria-hidden="true" data-demo-part="halo" class="[^"]*pointer-events-none[^"]*franki-halo/);
    expect(moving).toMatch(/aria-hidden="true" data-demo-part="floor" class="[^"]*franki-floor/);
    const still = renderToStaticMarkup(<DemoAvatar franki={LISTEN} speech={null} reduced />);
    expect(still).not.toContain("franki-halo");
    expect(still).not.toContain("franki-floor");
    expect(still).toContain('data-reduced="true"');
  });
});
