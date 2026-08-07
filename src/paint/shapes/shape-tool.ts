import type { AutomationElementReference } from "../../infrastructure/windows/automation/automation-types.js";

export interface ShapeDiscoveryInfo {
  strategy: string;
  confidence: number;
  matchedProperties: Record<string, unknown>;
}

export interface PaintShapeTool {
  id: string;
  displayName: string;
  automationId?: string;
  controlType?: string;
  nativeElement: AutomationElementReference;
  discovery: ShapeDiscoveryInfo;
  select(): Promise<void>;
}
