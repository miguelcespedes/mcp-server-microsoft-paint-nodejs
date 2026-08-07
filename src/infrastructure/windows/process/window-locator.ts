import * as proc from "../../win32/process.js";
import { PaintMcpError } from "../../errors/paint-mcp-error.js";

const PAINT_UWP_AUMID = "shell:AppsFolder\\Microsoft.Paint_8wekyb3d8bbwe!App";
const WINDOW_WAIT_TIMEOUT_MS = 10_000;

export interface LocatedPaintWindow extends proc.WindowInfo {
  createdBy: "opened" | "launched" | "shell";
}

export type WindowMode = "new" | "current";

function isPaintWindow(window: proc.WindowInfo): boolean {
  if (window.className === "MSPaintApp") {
    return true;
  }

  const genericHostClasses = new Set([
    "Window",
    "ApplicationFrameWindow",
    "Windows.UI.Core.CoreWindow",
  ]);

  return (
    genericHostClasses.has(window.className) &&
    window.title.toLowerCase().includes("paint")
  );
}

export function findPaintWindows(): proc.WindowInfo[] {
  return proc
    .enumerateWindows()
    .filter((window) => window.visible && isPaintWindow(window));
}

async function waitForPaintWindow(timeoutMs: number): Promise<proc.WindowInfo> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const windows = findPaintWindows();
    if (windows.length > 0) {
      return windows[0];
    }
    await proc.sleep(100);
  }

  throw new PaintMcpError(
    "PAINT_WINDOW_NOT_FOUND",
    `No Paint window was found after ${timeoutMs} ms.`,
  );
}

async function waitForNewPaintWindow(
  before: Set<bigint>,
  timeoutMs: number,
): Promise<proc.WindowInfo | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const fresh = findPaintWindows().find((window) => !before.has(window.hwnd));
    if (fresh) {
      return fresh;
    }
    await proc.sleep(100);
  }

  return null;
}

async function launchPaintWindow(): Promise<LocatedPaintWindow> {
  const pid = proc.spawnApplication("mspaint");

  try {
    const window = await proc.waitForWindowByPid(pid, WINDOW_WAIT_TIMEOUT_MS);
    return { ...window, createdBy: "opened" };
  } catch {
    proc.shellExecuteApp(PAINT_UWP_AUMID);
    const window = await waitForPaintWindow(WINDOW_WAIT_TIMEOUT_MS);
    return { ...window, createdBy: "opened" };
  }
}

async function createNewPaintWindow(): Promise<LocatedPaintWindow> {
  const before = new Set(findPaintWindows().map((window) => window.hwnd));
  proc.spawnApplication("mspaint");

  const viaLaunched = await waitForNewPaintWindow(before, 5_000);
  if (viaLaunched !== null) {
    return { ...viaLaunched, createdBy: "launched" };
  }

  proc.shellExecuteApp(PAINT_UWP_AUMID);
  const viaShell = await waitForNewPaintWindow(before, 5_000);
  if (viaShell !== null) {
    return { ...viaShell, createdBy: "shell" };
  }

  throw new PaintMcpError(
    "PAINT_WINDOW_NOT_FOUND",
    "Could not create a new Paint window.",
  );
}

export async function locatePaintWindow(
  openIfMissing: boolean,
  windowMode: WindowMode = "new",
): Promise<LocatedPaintWindow> {
  const existing = findPaintWindows();

  if (existing.length === 0) {
    if (!openIfMissing) {
      throw new PaintMcpError(
        "PAINT_NOT_RUNNING",
        "Paint is not running.",
      );
    }
    return launchPaintWindow();
  }

  if (!openIfMissing) {
    return { ...existing[0], createdBy: "opened" };
  }

  if (windowMode === "current") {
    return { ...existing[0], createdBy: "opened" };
  }

  return createNewPaintWindow();
}
