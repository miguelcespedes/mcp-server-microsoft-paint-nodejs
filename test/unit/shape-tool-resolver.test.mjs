import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildShapeGroups,
  resolveEllipseTool,
} from "../../dist/paint/discovery/shape-tool-resolver.js";

function createInventory(elements) {
  return {
    success: true,
    root: {
      id: "uia-0",
      parentId: null,
      depth: 0,
      runtimeId: [],
      name: "Paint",
      automationId: "",
      controlType: "Window",
      className: "MSPaintApp",
      frameworkId: "XAML",
      enabled: true,
      visible: true,
      nativeWindowHandle: "0x0000000000001000",
      boundingRectangle: null,
      supportedPatterns: [],
    },
    elements,
  };
}

const automationClient = {
  async invoke() {},
};

test("resolveEllipseTool prioritizes automationId over accessible name", () => {
  const inventory = createInventory([
    {
      id: "group-1",
      parentId: "uia-0",
      depth: 1,
      runtimeId: [1],
      name: "Shapes",
      automationId: "ShapesGroup",
      controlType: "Pane",
      className: "Pane",
      frameworkId: "XAML",
      enabled: true,
      visible: true,
      nativeWindowHandle: "0x1",
      boundingRectangle: null,
      supportedPatterns: [],
    },
    {
      id: "ellipse-1",
      parentId: "group-1",
      depth: 2,
      runtimeId: [10],
      name: "Circle-ish",
      automationId: "ellipse",
      controlType: "Button",
      className: "Button",
      frameworkId: "XAML",
      enabled: true,
      visible: true,
      nativeWindowHandle: "0x1",
      boundingRectangle: null,
      supportedPatterns: ["Invoke"],
    },
    {
      id: "ellipse-2",
      parentId: "group-1",
      depth: 2,
      runtimeId: [11],
      name: "Ellipse",
      automationId: "shape-unknown",
      controlType: "Button",
      className: "Button",
      frameworkId: "XAML",
      enabled: true,
      visible: true,
      nativeWindowHandle: "0x1",
      boundingRectangle: null,
      supportedPatterns: ["Invoke"],
    },
  ]);

  const tool = resolveEllipseTool(inventory, "0x0000000000001000", automationClient);
  assert.equal(tool.discovery.strategy, "automation-id");
  assert.equal(tool.nativeElement.automationId, "ellipse");
});

test("resolveEllipseTool fails on ambiguous matches", () => {
  const inventory = createInventory([
    {
      id: "ellipse-1",
      parentId: "uia-0",
      depth: 1,
      runtimeId: [10],
      name: "Ellipse",
      automationId: "shape-1",
      controlType: "Button",
      className: "Button",
      frameworkId: "XAML",
      enabled: true,
      visible: true,
      nativeWindowHandle: "0x1",
      boundingRectangle: null,
      supportedPatterns: ["Invoke"],
    },
    {
      id: "ellipse-2",
      parentId: "uia-0",
      depth: 1,
      runtimeId: [11],
      name: "Oval",
      automationId: "shape-2",
      controlType: "Button",
      className: "Button",
      frameworkId: "XAML",
      enabled: true,
      visible: true,
      nativeWindowHandle: "0x1",
      boundingRectangle: null,
      supportedPatterns: ["Invoke"],
    },
  ]);

  assert.throws(
    () => resolveEllipseTool(inventory, "0x0000000000001000", automationClient),
    /More than one ellipse-like control matched/,
  );
});

test("buildShapeGroups detects a shapes-like group", () => {
  const inventory = createInventory([
    {
      id: "group-1",
      parentId: "uia-0",
      depth: 1,
      runtimeId: [1],
      name: "Shapes",
      automationId: "ShapesGroup",
      controlType: "Pane",
      className: "Pane",
      frameworkId: "XAML",
      enabled: true,
      visible: true,
      nativeWindowHandle: "0x1",
      boundingRectangle: null,
      supportedPatterns: [],
    },
    ...["Rectangle", "Ellipse", "Triangle", "Arrow"].map((name, index) => ({
      id: `shape-${index}`,
      parentId: "group-1",
      depth: 2,
      runtimeId: [100 + index],
      name,
      automationId: name,
      controlType: "Button",
      className: "Button",
      frameworkId: "XAML",
      enabled: true,
      visible: true,
      nativeWindowHandle: "0x1",
      boundingRectangle: null,
      supportedPatterns: ["Invoke"],
    })),
  ]);

  const groups = buildShapeGroups(inventory);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].controls.length, 4);
});
