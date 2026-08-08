import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseWindowHandleHex,
  serializeWindowHandle,
} from "../../src/paint/discovery/canvas-resolver.js";

describe("paint/discovery/canvas-resolver - window handle serialization", () => {
  it("serializeWindowHandle keeps 64-bit hex formatting", () => {
    assert.equal(
      serializeWindowHandle(0x12345n),
      "0x0000000000012345",
    );
  });

  it("parseWindowHandleHex round-trips serialized handles", () => {
    const handle = 0x00000000abcdef01n;
    assert.equal(parseWindowHandleHex(serializeWindowHandle(handle)), handle);
  });
});
