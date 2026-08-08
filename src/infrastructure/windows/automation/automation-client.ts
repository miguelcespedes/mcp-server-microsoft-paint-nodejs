import { spawn } from "node:child_process";
import path from "node:path";
import { PaintMcpError } from "../../errors/paint-mcp-error.js";
import type {
  AutomationElementSnapshot,
  AutomationInventoryPayload,
  AutomationInventoryResult,
  AutomationInvokePayload,
  AutomationInvokeResult,
  AutomationSetValuePayload,
  AutomationSetValueResult,
} from "./automation-types.js";

function normalizePatterns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
}

function normalizeElementArray(value: unknown): AutomationElementSnapshot[] {
  if (Array.isArray(value)) {
    return value as AutomationElementSnapshot[];
  }
  if (value && typeof value === "object") {
    return [value as AutomationElementSnapshot];
  }
  return [];
}

function normalizeElement(
  element: AutomationElementSnapshot,
): AutomationElementSnapshot {
  return {
    ...element,
    parentId: element.parentId || null,
    supportedPatterns: normalizePatterns(element.supportedPatterns),
  };
}

function normalizeInventoryResult(
  result: AutomationInventoryResult,
): AutomationInventoryResult {
  const elements = normalizeElementArray((result as { elements?: unknown }).elements);
  return {
    ...result,
    root: normalizeElement(result.root),
    elements: elements.map(normalizeElement),
  };
}

interface BridgeCommand {
  id: string;
  action: "inventory" | "invoke" | "set-value";
  payload: unknown;
}

interface BridgeResponse {
  id: string;
  success: boolean;
  [key: string]: unknown;
}

class PersistentPowerShellBridge {
  private childProcess: ReturnType<typeof spawn> | null = null;
  private readonly pending = new Map<string, { resolve: (value: BridgeResponse) => void; reject: (error: Error) => void }>();
  private requestId = 0;
  private stdoutBuffer = "";
  private isStarting = false;
  private startPromise: Promise<void> | null = null;

  private getScriptPath(): string {
    return path.join(process.cwd(), "scripts", "paint-uia-bridge.ps1");
  }

  private async ensureStarted(): Promise<void> {
    if (this.childProcess && !this.childProcess.killed) {
      return;
    }
    if (this.isStarting) {
      return this.startPromise!;
    }
    this.isStarting = true;
    this.startPromise = this.doStart();
    try {
      await this.startPromise;
    } finally {
      this.isStarting = false;
    }
  }

  private async doStart(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.getScriptPath(),
          "-Server",
        ],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      this.childProcess = child;

      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        const lines = (this.stdoutBuffer + chunk).split("\n");
        this.stdoutBuffer = lines.pop() || "";
        for (const line of lines) {
          this.handleResponseLine(line.trim());
        }
      });

      child.on("error", (error) => {
        this.childProcess = null;
        reject(new PaintMcpError("UI_AUTOMATION_UNAVAILABLE", `Failed to start persistent PowerShell bridge: ${error.message}`));
      });

      child.on("close", (code) => {
        this.childProcess = null;
        for (const [, { reject }] of this.pending) {
          reject(new PaintMcpError("UI_AUTOMATION_UNAVAILABLE", `PowerShell bridge exited with code ${code ?? -1}: ${stderr}`));
        }
        this.pending.clear();
      });

      setTimeout(resolve, 500);
    });
  }

  private handleResponseLine(line: string): void {
    if (!line) return;
    try {
      const response = JSON.parse(line) as BridgeResponse;
      const { id } = response;
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.resolve(response);
      }
    } catch {
    }
  }

  async send<T extends BridgeResponse>(command: Omit<BridgeCommand, "id">): Promise<T> {
    await this.ensureStarted();
    const id = `req-${++this.requestId}-${Date.now()}`;
    const fullCommand: BridgeCommand = { ...command, id };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: BridgeResponse) => void, reject });
      const line = JSON.stringify(fullCommand);
      this.childProcess?.stdin?.write(line + "\n", (error) => {
        if (error) {
          this.pending.delete(id);
          reject(new PaintMcpError("UI_AUTOMATION_UNAVAILABLE", `Failed to write to bridge stdin: ${error.message}`));
        }
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new PaintMcpError("UI_AUTOMATION_UNAVAILABLE", "Bridge request timed out"));
        }
      }, 30000);
    }) as Promise<T>;
  }

  async stop(): Promise<void> {
    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.kill();
      this.childProcess = null;
    }
    this.pending.clear();
  }
}

const persistentBridge = new PersistentPowerShellBridge();

async function runBridgeLegacy<T>(action: string, payload: unknown): Promise<T> {
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const scriptPath = path.join(process.cwd(), "scripts", "paint-uia-bridge.ps1");

  return new Promise<T>((resolve, reject) => {
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        action,
        payloadBase64,
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(
        new PaintMcpError(
          "UI_AUTOMATION_UNAVAILABLE",
          `Failed to start the PowerShell UI Automation bridge: ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      try {
        const parsed = JSON.parse(stdout || "{}");
        if (code === 0 && parsed.success !== false) {
          resolve(parsed as T);
          return;
        }
        reject(
          new PaintMcpError(
            "UI_AUTOMATION_UNAVAILABLE",
            parsed.error ??
              [
                `The PowerShell UI Automation bridge failed with exit code ${code ?? -1}.`,
                stderr.trim(),
                stdout.trim(),
              ]
                .filter((part) => part.length > 0)
                .join(" "),
            {
              ...(parsed.errorType ? { errorType: parsed.errorType } : {}),
              ...(parsed.positionMessage ? { positionMessage: parsed.positionMessage } : {}),
              ...(parsed.scriptStackTrace ? { scriptStackTrace: parsed.scriptStackTrace } : {}),
              ...(stderr ? { stderr } : {}),
              ...(stdout ? { stdout } : {}),
            },
          ),
        );
      } catch (error) {
        reject(
          new PaintMcpError(
            "UI_AUTOMATION_UNAVAILABLE",
            "The PowerShell UI Automation bridge returned invalid JSON.",
            {
              stdout,
              stderr,
              parseError: error instanceof Error ? error.message : String(error),
            },
          ),
        );
      }
    });
  });
}

export class AutomationClient {
  private usePersistent = true;

  async inventory(
    payload: AutomationInventoryPayload,
  ): Promise<AutomationInventoryResult> {
    if (this.usePersistent) {
      try {
        const result = await persistentBridge.send({
          action: "inventory",
          payload,
        });
        return normalizeInventoryResult(result as unknown as AutomationInventoryResult);
      } catch (error) {
        this.usePersistent = false;
        return this.inventory(payload);
      }
    }
    const result = await runBridgeLegacy<AutomationInventoryResult>("inventory", payload);
    return normalizeInventoryResult(result);
  }

  async invoke(
    payload: AutomationInvokePayload,
  ): Promise<AutomationInvokeResult> {
    if (this.usePersistent) {
      try {
        const result = await persistentBridge.send({
          action: "invoke",
          payload,
        });
        return result as unknown as AutomationInvokeResult;
      } catch (error) {
        this.usePersistent = false;
        return this.invoke(payload);
      }
    }
    return runBridgeLegacy<AutomationInvokeResult>("invoke", payload);
  }

  async setValue(
    payload: AutomationSetValuePayload,
  ): Promise<AutomationSetValueResult> {
    if (this.usePersistent) {
      try {
        const result = await persistentBridge.send({
          action: "set-value",
          payload,
        });
        return result as unknown as AutomationSetValueResult;
      } catch (error) {
        this.usePersistent = false;
        return this.setValue(payload);
      }
    }
    return runBridgeLegacy<AutomationSetValueResult>("set-value", payload);
  }

  async shutdown(): Promise<void> {
    await persistentBridge.stop();
  }
}