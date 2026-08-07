import {
  locatePaintWindow,
  type WindowMode,
} from "../../infrastructure/windows/process/window-locator.js";
import type { Logger } from "../../infrastructure/logging/logger.js";
import * as proc from "../../infrastructure/win32/process.js";
import type { AutomationElementReference } from "../../infrastructure/windows/automation/automation-types.js";

export interface PaintSession {
  processId: number;
  windowHandle: string;
  windowTitle: string;
  className: string;
  createdBy: "opened" | "launched" | "shell";
  automationRoot: AutomationElementReference;
  discoveredAt: string;
}

export class PaintSessionStore {
  private current: PaintSession | null = null;

  constructor(private readonly logger?: Logger) {}

  getCurrent(): PaintSession | null {
    return this.current;
  }

  async locate(
    openIfMissing: boolean,
    windowMode: WindowMode = "new",
  ): Promise<PaintSession> {
    const window = await locatePaintWindow(openIfMissing, windowMode);
    const session: PaintSession = {
      processId: window.pid,
      windowHandle: `0x${window.hwnd.toString(16).padStart(16, "0")}`,
      windowTitle: window.title,
      className: window.className,
      createdBy: window.createdBy,
      automationRoot: {
        stableId: "root",
        runtimeId: [],
        windowHandleHex: `0x${window.hwnd.toString(16).padStart(16, "0")}`,
        name: window.title,
        automationId: "",
        controlType: "Window",
        className: window.className,
        supportedPatterns: [],
      },
      discoveredAt: new Date().toISOString(),
    };

    this.current = session;
    return session;
  }

  async ensureReady(options?: {
    openIfMissing?: boolean;
    windowMode?: WindowMode;
    maximize?: boolean;
    foreground?: boolean;
    refreshAutomationTree?: boolean;
  }): Promise<PaintSession> {
    const session = await this.locate(
      options?.openIfMissing ?? true,
      options?.windowMode ?? "new",
    );
    const hwnd = BigInt(session.windowHandle);

    await proc.ensureWindowReady(hwnd, {
      maximize: options?.maximize ?? true,
      foreground: options?.foreground ?? true,
      logger: this.logger,
    });

    if (options?.refreshAutomationTree ?? true) {
      this.logger?.debug("UI Automation tree invalidated and will be rebuilt", {
        hwnd: session.windowHandle,
      });
    }

    const refreshed = {
      ...session,
      discoveredAt: new Date().toISOString(),
    };
    this.current = refreshed;
    return refreshed;
  }
}
