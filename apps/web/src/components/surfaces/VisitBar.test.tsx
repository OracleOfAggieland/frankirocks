import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { COPY } from "../../ui/copy";
import { VisitBar, type VisitBarProps } from "./VisitBar";

const noop = () => {};
const BASE: VisitBarProps = {
  phase: "ready",
  failure: null,
  bolt: "idle",
  boltFailed: false,
  confirming: false,
  endingCall: false,
  targets: [
    { id: "evening", label: "Today, 6 PM", toMs: 100 },
    { id: "threeWeeks", label: "Three weeks on", toMs: 200 },
  ],
  boltEnabled: true,
  onBolt: noop,
  onRetry: noop,
  onStartOver: noop,
  onConfirm: noop,
  onCancel: noop,
};
const html = (p: Partial<VisitBarProps>) => renderToStaticMarkup(<VisitBar {...BASE} {...p} />);

function click(el: unknown, match: (props: Record<string, unknown>) => boolean): boolean {
  if (el === null || typeof el !== "object") return false;
  if (Array.isArray(el)) return el.some((c) => click(c, match));
  const node = el as { type: unknown; props: Record<string, unknown> };
  if (typeof node.type === "function") return click((node.type as (p: unknown) => unknown)(node.props), match);
  if (node.props && match(node.props) && typeof node.props.onClick === "function") {
    (node.props.onClick as () => void)();
    return true;
  }
  return click(node.props?.children, match);
}

describe("VisitBar", () => {
  it("ready: one button per labeled target, never a date field, and Start over", () => {
    const out = html({});
    expect(out).toContain("Today, 6 PM");
    expect(out).toContain("Three weeks on");
    expect(out).not.toContain("<input");
    expect(out).toContain('data-action="start-over"');
    expect(out).not.toContain('disabled=""');
  });

  it("a target press sends its time", () => {
    const onBolt = vi.fn();
    expect(click(VisitBar({ ...BASE, onBolt }), (p) => p["data-bolt-target"] === "threeWeeks")).toBe(true);
    expect(onBolt).toHaveBeenCalledWith(200);
  });

  it("waiting: the targets are disabled and say they are waiting", () => {
    const out = html({ bolt: "waiting", boltEnabled: false });
    expect(out).toContain('data-bolt="waiting"');
    expect(out).toContain(COPY.visit.bolt.waiting);
    expect(out.match(/data-bolt-target="[^"]+" disabled=""/g)).toHaveLength(2);
  });

  it("a bolt that did not move says so", () => {
    expect(html({ boltFailed: true })).toContain(COPY.visit.bolt.didNotMove.replace("'", "&#x27;"));
  });

  it("start over asks once before it goes", () => {
    const onConfirm = vi.fn();
    const out = html({ confirming: true });
    expect(out).toContain(COPY.visit.confirm.question);
    expect(out).not.toContain('data-action="start-over"');
    click(VisitBar({ ...BASE, confirming: true, onConfirm }), (p) => p["data-action"] === "confirm-start-over");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cloning and resetting show their state, and a reset during a call says it ends the call first", () => {
    expect(html({ phase: "cloning" })).toContain(COPY.visit.cloning);
    expect(html({ phase: "resetting" })).toContain(COPY.visit.resetting);
    expect(html({ phase: "resetting", endingCall: true })).toContain(COPY.visit.endingCall);
    expect(html({ phase: "cloning" })).not.toContain("data-bolt-target");
  });

  it("failed shows a way to try again and no bolt", () => {
    const onRetry = vi.fn();
    const out = html({ phase: "failed", failure: "clone" });
    expect(out).toContain(COPY.visit.retry);
    expect(out).not.toContain("data-bolt-target");
    click(VisitBar({ ...BASE, phase: "failed", failure: "interrupted", onRetry }), (p) => p["data-action"] === "retry-visit");
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
