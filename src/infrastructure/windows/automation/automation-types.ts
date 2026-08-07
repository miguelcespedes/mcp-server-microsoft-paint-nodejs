export interface RectangleLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AutomationElementReference {
  stableId: string;
  runtimeId: number[];
  windowHandleHex: string;
  processId?: number;
  name: string;
  automationId: string;
  controlType: string;
  className: string;
  boundingRectangle?: RectangleLike | null;
  supportedPatterns: string[];
}

export interface AutomationElementSnapshot {
  id: string;
  parentId: string | null;
  depth: number;
  runtimeId: number[];
  name: string;
  automationId: string;
  controlType: string;
  className: string;
  frameworkId: string;
  enabled: boolean;
  visible: boolean;
  nativeWindowHandle: string;
  boundingRectangle: RectangleLike | null;
  supportedPatterns: string[];
}

export interface AutomationInventoryPayload {
  windowHandleHex: string;
  processId?: number;
  className?: string;
  windowTitle?: string;
  maxDepth: number;
  includeBoundingRectangles: boolean;
  scope?: "window" | "desktop-children";
}

export interface AutomationInventoryResult {
  success: boolean;
  root: AutomationElementSnapshot;
  elements: AutomationElementSnapshot[];
}

export interface AutomationInvokePayload {
  windowHandleHex: string;
  processId?: number;
  className?: string;
  windowTitle?: string;
  runtimeId: number[];
}

export interface AutomationInvokeResult {
  success: boolean;
  pattern: string;
}

export interface AutomationSetValuePayload {
  windowHandleHex: string;
  processId?: number;
  className?: string;
  windowTitle?: string;
  runtimeId: number[];
  value: string;
}

export interface AutomationSetValueResult {
  success: boolean;
  pattern: string;
}
