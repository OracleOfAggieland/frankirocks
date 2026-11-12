// The build's yield (brief 013 rule 6): each step must queue behind work already waiting, so the voice client's
// timers, network callbacks and data-channel messages run between the build steps.
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PostingScheduler, yieldToBrowser } from "./three-host";

describe("yieldToBrowser", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts a background task where the browser has scheduler.postTask", async () => {
    const posted: string[] = [];
    const s: PostingScheduler = {
      postTask: (cb, options) => {
        posted.push(options.priority);
        cb();
        return Promise.resolve();
      },
    };
    await expect(yieldToBrowser(s)).resolves.toBeUndefined();
    expect(posted).toEqual(["background"]);
  });

  it("never uses scheduler.yield, whose continuation runs ahead of queued tasks", async () => {
    const yielded = vi.fn(() => Promise.resolve());
    const s = { yield: yielded } as PostingScheduler & { yield: () => Promise<void> };
    vi.useFakeTimers();
    const done = yieldToBrowser(s);
    await vi.advanceTimersByTimeAsync(0);
    await expect(done).resolves.toBeUndefined();
    expect(yielded).not.toHaveBeenCalled();
  });

  it("falls back to a zero timeout, a new task behind the ones already queued", async () => {
    vi.useFakeTimers();
    let resolved = false;
    void yieldToBrowser({}).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });
});
