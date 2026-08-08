import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  arrowPolyline,
  chartStrokes,
  stickFigure,
} from "../../src/domain/napkin.js";

describe("domain/napkin - Dan Roam codex primitives", () => {
  describe("arrowPolyline", () => {
    it("produces 3 strokes: shaft + two head lines", () => {
      const strokes = arrowPolyline({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
      assert.equal(strokes.length, 3);
    });

    it("shaft ends exactly at the target point", () => {
      const to = { x: 100, y: 40 };
      const [shaft] = arrowPolyline({ from: { x: 0, y: 0 }, to });
      assert.deepStrictEqual(shaft[shaft.length - 1], to);
    });

    it("both head lines end at the target point", () => {
      const to = { x: 50, y: 50 };
      const [, headLeft, headRight] = arrowPolyline({ from: { x: 0, y: 0 }, to });
      assert.deepStrictEqual(headLeft[headLeft.length - 1], to);
      assert.deepStrictEqual(headRight[headRight.length - 1], to);
    });

    it("degenerate arrow (from === to) still returns a valid stroke", () => {
      const strokes = arrowPolyline({ from: { x: 10, y: 10 }, to: { x: 10, y: 10 } });
      assert.equal(strokes.length, 1);
    });
  });

  describe("stickFigure", () => {
    it("returns a head circle plus torso/arms/legs strokes for every pose", () => {
      const poses = ["standing", "walking", "pointing", "sitting", "thinking"] as const;
      for (const pose of poses) {
        const strokes = stickFigure({ x: 100, y: 200, scale: 20, pose });
        // head (closed polyline) + torso + at least 2 legs + at least 1 arm
        assert.ok(strokes.length >= 4, `pose ${pose} should have at least 4 strokes`);
      }
    });

    it("keeps the head radius equal to the requested scale", () => {
      const scale = 25;
      const [head] = stickFigure({ x: 0, y: 0, scale });
      const xs = head.map((p) => p.x);
      const width = Math.max(...xs) - Math.min(...xs);
      assert.ok(Math.abs(width - scale * 2) <= 1, `head width ${width} should be ~${scale * 2}`);
    });

    it("feet sit at the requested y for the standing pose", () => {
      const feetY = 300;
      const strokes = stickFigure({ x: 0, y: feetY, scale: 20, pose: "standing" });
      const legs = strokes.slice(2, 4);
      for (const leg of legs) {
        assert.equal(leg[leg.length - 1].y, feetY);
      }
    });
  });

  describe("chartStrokes", () => {
    it("scales the tallest bar to the full available height", () => {
      const strokes = chartStrokes({ x: 0, y: 0, width: 200, height: 100, values: [1, 5, 2] });
      // strokes[0] is the axis, bars follow in order
      const bars = strokes.slice(1);
      const heights = bars.map((bar) => {
        const ys = bar.map((p) => p.y);
        return Math.max(...ys) - Math.min(...ys);
      });
      assert.equal(bars.length, 3);
      assert.ok(Math.abs(Math.max(...heights) - 100) <= 1);
    });

    it("returns just the axis for an empty values array", () => {
      const strokes = chartStrokes({ x: 0, y: 0, width: 200, height: 100, values: [] });
      assert.equal(strokes.length, 1);
    });
  });
});
