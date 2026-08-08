import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rectsIntersect, type Rectangle2D } from "../../src/infrastructure/win32/process.js";

const rect = (left: number, top: number, width: number, height: number): Rectangle2D => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe("infrastructure/win32/process - rectsIntersect (window-on-visible-monitor logic)", () => {
  it("detects overlap when the window sits inside the monitor", () => {
    const monitor = rect(0, 0, 1920, 1080);
    const window = rect(100, 100, 800, 600);
    assert.equal(rectsIntersect(window, monitor), true);
  });

  it("detects overlap for a window straddling a monitor edge", () => {
    const monitor = rect(0, 0, 1920, 1080);
    const window = rect(-100, 100, 400, 400);
    assert.equal(rectsIntersect(window, monitor), true);
  });

  it("reports no overlap for a window entirely off any monitor", () => {
    // Reproduces the reported incident: a window reported at a large negative
    // screen origin (e.g. after a secondary monitor was disconnected), with
    // no monitor covering it. Drawing on such a window is silently invisible.
    const monitor = rect(0, 0, 1920, 1080);
    const window = rect(-1386, 598, 800, 600);
    assert.equal(rectsIntersect(window, monitor), false);
  });

  it("reports no overlap when the window is fully to the right of the monitor", () => {
    const monitor = rect(0, 0, 1920, 1080);
    const window = rect(2000, 100, 400, 400);
    assert.equal(rectsIntersect(window, monitor), false);
  });
});
