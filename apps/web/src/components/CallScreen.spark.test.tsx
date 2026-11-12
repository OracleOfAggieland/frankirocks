// The ring spark at rest (brief 014, B3; lab-ui-foundation R10.3, R10.4): no spark is drawn until a press
// takes a grant, so the markup of every voice phase has no spark span.
import { type VoicePhase, type VoiceState, initialVoiceState } from "@franki/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CallScreen } from "./CallScreen";

const noop = () => {};
const base = initialVoiceState({ transcribeModel: "m" });
const screen = (v: VoiceState) =>
  renderToStaticMarkup(<CallScreen voice={v} enabled={true} onCall={noop} onHangUp={noop} onToggleMute={noop} onRetry={noop} />);

const PHASES: readonly VoicePhase[] = [
  "CLOSED",
  "CONNECTING",
  "CONFIGURING",
  "LISTENING",
  "WAIT_ITEM",
  "JUDGING",
  "SPECULATING",
  "HELD",
  "SPEAKING",
  "TOOL_WAIT",
  "SWAPPING",
  "RECOVERY",
];

describe("ring spark at rest", () => {
  it("the closed and the live markup draw no spark", () => {
    for (const phase of PHASES) {
      const html = screen({ ...base, phase });
      expect(html, phase).not.toContain("data-ring-spark");
      expect(html, phase).not.toContain("franki-ring-spark");
    }
    expect(screen(base)).toContain('data-form="start"');
  });
});
