/**
 * Verificación visual post-dibujo: captura una región de pantalla y reporta
 * si contiene tinta (píxeles no blancos), delegando la captura en
 * scripts/paint-screenshot.ps1 (System.Drawing.Bitmap/CopyFromScreen).
 *
 * Se usa PowerShell en vez de bindings gdi32 vía koffi: la captura de
 * pantalla ya es una línea en .NET y añadir BitBlt/GetDC/CreateCompatibleDC
 * duplicaría esa capacidad sin necesidad.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "../logging/logger.js";
import type { Rectangle2D } from "./process.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "../../../scripts/paint-screenshot.ps1");

export interface ScreenshotVerification {
  hasInk: boolean | null;
  nonWhiteRatio: number | null;
  reason?: string;
}

interface ScreenshotScriptResult {
  ok: boolean;
  hasInk?: boolean;
  nonWhiteRatio?: number;
  error?: string;
}

/**
 * Captura la región de pantalla indicada y determina si contiene tinta
 * (píxeles no blancos). Es "best effort": si la sonda falla (PowerShell no
 * disponible, timeout, etc.) devuelve hasInk: null con el motivo, en vez de
 * hacer fallar la operación de dibujo que la invocó.
 */
export async function captureRegionHasInk(
  region: Pick<Rectangle2D, "left" | "top" | "width" | "height">,
  logger?: Logger,
  timeoutMs = 5_000,
): Promise<ScreenshotVerification> {
  if (region.width <= 0 || region.height <= 0) {
    return { hasInk: null, nonWhiteRatio: null, reason: "Región de captura vacía." };
  }

  try {
    const result = await runScreenshotScript(region, timeoutMs);
    if (!result.ok) {
      logger?.debug("Screenshot verification script reported failure", {
        error: result.error,
      });
      return { hasInk: null, nonWhiteRatio: null, reason: result.error ?? "Fallo desconocido." };
    }
    return {
      hasInk: result.hasInk ?? null,
      nonWhiteRatio: result.nonWhiteRatio ?? null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger?.debug("Screenshot verification failed", { reason });
    return { hasInk: null, nonWhiteRatio: null, reason };
  }
}

function runScreenshotScript(
  region: Pick<Rectangle2D, "left" | "top" | "width" | "height">,
  timeoutMs: number,
): Promise<ScreenshotScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        SCRIPT_PATH,
        "-X",
        String(Math.round(region.left)),
        "-Y",
        String(Math.round(region.top)),
        "-Width",
        String(Math.round(region.width)),
        "-Height",
        String(Math.round(region.height)),
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`paint-screenshot.ps1 excedió el timeout de ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", () => {
      clearTimeout(timer);
      const line = stdout.trim().split("\n").pop() ?? "";
      if (!line) {
        reject(new Error(stderr.trim() || "paint-screenshot.ps1 no devolvió salida."));
        return;
      }
      try {
        resolve(JSON.parse(line) as ScreenshotScriptResult);
      } catch {
        reject(new Error(`Salida no-JSON de paint-screenshot.ps1: ${line}`));
      }
    });
  });
}
