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

function getBridgeScriptPath(): string {
  return path.join(process.cwd(), "scripts", "paint-uia.ps1");
}

async function runBridge<T>(action: string, payload: unknown): Promise<T> {
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64",
  );

  return new Promise<T>((resolve, reject) => {
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        getBridgeScriptPath(),
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
              ...(parsed.positionMessage
                ? { positionMessage: parsed.positionMessage }
                : {}),
              ...(parsed.scriptStackTrace
                ? { scriptStackTrace: parsed.scriptStackTrace }
                : {}),
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
  async inventory(
    payload: AutomationInventoryPayload,
  ): Promise<AutomationInventoryResult> {
    const result = await runBridge<AutomationInventoryResult>("inventory", payload);
    return normalizeInventoryResult(result);
  }

  async invoke(
    payload: AutomationInvokePayload,
  ): Promise<AutomationInvokeResult> {
    return runBridge<AutomationInvokeResult>("invoke", payload);
  }

  async setValue(
    payload: AutomationSetValuePayload,
  ): Promise<AutomationSetValueResult> {
    return runBridge<AutomationSetValueResult>("set-value", payload);
  }
}
