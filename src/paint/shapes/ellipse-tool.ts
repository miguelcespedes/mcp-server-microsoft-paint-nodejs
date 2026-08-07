import type { AutomationClient } from "../../infrastructure/windows/automation/automation-client.js";
import type { AutomationElementReference } from "../../infrastructure/windows/automation/automation-types.js";
import * as proc from "../../infrastructure/win32/process.js";
import type { PaintShapeTool, ShapeDiscoveryInfo } from "./shape-tool.js";

export class EllipseTool implements PaintShapeTool {
  readonly id = "ellipse";

  constructor(
    public readonly displayName: string,
    public readonly nativeElement: AutomationElementReference,
    public readonly discovery: ShapeDiscoveryInfo,
    private readonly automationClient: AutomationClient,
  ) {}

  get automationId(): string | undefined {
    return this.nativeElement.automationId || undefined;
  }

  get controlType(): string | undefined {
    return this.nativeElement.controlType || undefined;
  }

  async select(): Promise<void> {
    const patterns = new Set(this.nativeElement.supportedPatterns);
    const canInvoke =
      patterns.has("InvokePatternIdentifiers.Pattern") ||
      patterns.has("SelectionItemPatternIdentifiers.Pattern") ||
      patterns.has("LegacyIAccessiblePatternIdentifiers.Pattern");

    if (canInvoke) {
      await this.automationClient.invoke({
        windowHandleHex: this.nativeElement.windowHandleHex,
        processId: this.nativeElement.processId,
        className: this.nativeElement.className,
        windowTitle: this.nativeElement.name,
        runtimeId: this.nativeElement.runtimeId,
      });
      return;
    }

    const rect = this.nativeElement.boundingRectangle;
    if (!rect) {
      throw new Error(
        "The ellipse tool does not expose an invokable automation pattern or a bounding rectangle fallback.",
      );
    }

    await proc.clickAt({
      x: rect.left + Math.round(rect.width / 2),
      y: rect.top + Math.round(rect.height / 2),
    });
  }
}
