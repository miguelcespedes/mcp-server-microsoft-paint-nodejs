import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWindowHandleHex,
  serializeWindowHandle,
} from "../../dist/paint/discovery/canvas-resolver.js";

test("serializeWindowHandle keeps 64-bit hex formatting", () => {
  assert.equal(
    serializeWindowHandle(0x12345n),
    "0x0000000000012345",
  );
});

test("parseWindowHandleHex round-trips serialized handles", () => {
  const handle = 0x00000000abcdef01n;
  assert.equal(parseWindowHandleHex(serializeWindowHandle(handle)), handle);
});
