/**
 * Lógica genérica de Windows: procesos y ventanas.
 *
 * No conoce nada específico de Paint: aquí viven los helpers reutilizables
 * para lanzar procesos, enumerar ventanas, traerlas al primer plano y
 * simular el mouse con Win32.
 */

import { spawn } from "node:child_process";
import * as shell from "./shell.js";
import * as win32 from "./user32.js";

export interface Point2D {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface WindowInfo {
  /** HWND como BigInt (64 bits completos en x64). */
  hwnd: bigint;
  /** PID del proceso dueño de la ventana. */
  pid: number;
  title: string;
  className: string;
  visible: boolean;
}

export interface FocusResult {
  success: boolean;
  warning?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades básicas
// ─────────────────────────────────────────────────────────────────────────────

/** Convierte un HWND a una representación segura y legible: string hexadecimal. */
export function hwndToHexString(hwnd: bigint): string {
  return `0x${hwnd.toString(16).padStart(16, "0")}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Comprueba que el HWND no sea nulo y que la ventana siga existiendo. */
export function isValidWindow(hwnd: bigint): boolean {
  return hwnd !== 0n && Boolean(win32.isWindow(hwnd));
}

/** Lanza un error claro si la ventana ya no existe. */
export function assertValidWindow(hwnd: bigint, context: string): void {
  if (!isValidWindow(hwnd)) {
    throw new Error(
      `${context}: la ventana (${hwndToHexString(hwnd)}) ya no existe o el identificador no es válido.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inspección de ventanas
// ─────────────────────────────────────────────────────────────────────────────

/** Lee el título de una ventana (cadena UTF-16, hasta 512 caracteres). */
export function getWindowTitle(hwnd: bigint): string {
  try {
    const buffer = Buffer.alloc(1024);
    const length = win32.getWindowTextW(hwnd, buffer, buffer.byteLength / 2);
    if (length <= 0) {
      return "";
    }
    return buffer.toString("utf16le", 0, length * 2);
  } catch {
    return "";
  }
}

/** Lee el nombre de clase de una ventana (cadena UTF-16, hasta 128 caracteres). */
export function getWindowClassName(hwnd: bigint): string {
  try {
    const buffer = Buffer.alloc(256);
    const length = win32.getClassNameW(hwnd, buffer, buffer.byteLength / 2);
    if (length <= 0) {
      return "";
    }
    return buffer.toString("utf16le", 0, length * 2);
  } catch {
    return "";
  }
}

/** Obtiene el PID del proceso dueño de la ventana (0 si falla). */
export function getWindowProcessId(hwnd: bigint): number {
  try {
    const pidOut: Array<number | null> = [null];
    win32.getWindowThreadProcessId(hwnd, pidOut);
    return pidOut[0] ?? 0;
  } catch {
    return 0;
  }
}

/** Obtiene la información completa de una ventana. */
export function getWindowInfo(hwnd: bigint): WindowInfo {
  return {
    hwnd,
    pid: getWindowProcessId(hwnd),
    title: getWindowTitle(hwnd),
    className: getWindowClassName(hwnd),
    visible: Boolean(win32.isWindowVisible(hwnd)),
  };
}

/**
 * Enumerar todas las ventanas de nivel superior.
 * El callback de EnumWindows es transitorio (solo vive durante la llamada),
 * por lo que es seguro usarlo aquí de forma síncrona.
 */
export function enumerateWindows(): WindowInfo[] {
  const windows: WindowInfo[] = [];

  const callback: win32.EnumWindowsProc = (hwnd, _lParam) => {
    try {
      windows.push(getWindowInfo(hwnd));
    } catch {
      // La ventana pudo ser destruida entre la enumeración y la lectura;
      // se omite sin interrumpir el barrido.
    }
    return true;
  };

  const succeeded = win32.enumWindows(callback, 0);
  if (!succeeded) {
    throw new Error("EnumWindows falló al enumerar las ventanas.");
  }

  return windows;
}

/** Busca todas las ventanas de nivel superior pertenecientes a un PID. */
export function findWindowsByPid(pid: number): WindowInfo[] {
  return enumerateWindows().filter((window) => window.pid === pid);
}

/**
 * Espera de forma controlada (polling) a que aparezca una ventana VISIBLE
 * perteneciente al PID dado. Lanza un error si se agota el tiempo.
 */
export async function waitForWindowByPid(
  pid: number,
  timeoutMs: number,
  pollIntervalMs = 100,
): Promise<WindowInfo> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const candidates = findWindowsByPid(pid);
    const visible = candidates.find((window) => window.visible);
    if (visible) {
      return visible;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `No se encontró ninguna ventana visible del proceso con PID ${pid} tras ${timeoutMs} ms.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Primer plano
// ─────────────────────────────────────────────────────────────────────────────
//
// Windows restringe SetForegroundWindow cuando el proceso llamador no está en
// primer plano. Se usa el truco clásico de AttachThreadInput: mientras el hilo
// de la ventana activa está conectado al hilo del proceso destino, el cambio
// de primer plano está permitido. Si todo falla, se reporta una advertencia en
// lugar de fallar silenciosamente.

/** Intenta llevar la ventana al primer plano (con y sin truco de hilos). */
function trySetForegroundWindow(hwnd: bigint): boolean {
  const targetThread =
    win32.getWindowThreadProcessId(hwnd, [null]) ?? 0;

  const foregroundHwnd = win32.getForegroundWindow();
  const foregroundThread =
    foregroundHwnd === 0n
      ? 0
      : (win32.getWindowThreadProcessId(foregroundHwnd, [null]) ?? 0);

  if (
    targetThread !== 0 &&
    foregroundThread !== 0 &&
    foregroundThread !== targetThread
  ) {
    const attached = Boolean(
      win32.attachThreadInput(foregroundThread, targetThread, true),
    );
    if (attached) {
      try {
        if (win32.setForegroundWindow(hwnd)) {
          return true;
        }
      } finally {
        win32.attachThreadInput(foregroundThread, targetThread, false);
      }
    }
  }

  return Boolean(win32.setForegroundWindow(hwnd));
}

export async function bringWindowToFront(hwnd: bigint): Promise<FocusResult> {
  assertValidWindow(hwnd, "bringWindowToFront");

  // Solo se restaura si la ventana está minimizada: SW_RESTORE sobre una
  // ventana maximizada la des-maximizaría, rompiendo el estado que el
  // llamador pudo haber establecido con maximizeWindow.
  if (win32.isIconic(hwnd)) {
    win32.showWindow(hwnd, win32.SW_RESTORE);
  }

  let focused = trySetForegroundWindow(hwnd);
  for (let attempt = 0; attempt < 9 && !focused; attempt++) {
    await sleep(50);
    focused = trySetForegroundWindow(hwnd);
  }

  if (focused) {
    return { success: true };
  }

  return {
    success: false,
    warning:
      "Windows no permitió llevar la ventana al primer plano. " +
      "El dibujo podría fallar si la ventana queda oculta.",
  };
}

/**
 * Maximiza la ventana (SW_MAXIMIZE). No toca el estado minimizado/oculto de
 * forma destructiva: si la ventana estuviera minimizada, primero se restaura.
 * Devuelve true si la operación tuvo éxito.
 */
export function maximizeWindow(hwnd: bigint): boolean {
  assertValidWindow(hwnd, "maximizeWindow");
  return Boolean(win32.showWindow(hwnd, win32.SW_MAXIMIZE));
}

// ─────────────────────────────────────────────────────────────────────────────
// Área cliente y coordenadas
// ─────────────────────────────────────────────────────────────────────────────

/** Tamaño del área cliente de la ventana (GetClientRect). */
export function getClientSize(hwnd: bigint): Size2D {
  assertValidWindow(hwnd, "getClientSize");

  const rect: win32.RectLike = { left: 0, top: 0, right: 0, bottom: 0 };
  const succeeded = win32.getClientRect(hwnd, rect);
  if (!succeeded) {
    throw new Error(
      `GetClientRect falló para la ventana ${hwndToHexString(hwnd)}.`,
    );
  }

  return {
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

/** Convierte coordenadas del área cliente a coordenadas absolutas de pantalla. */
export function clientToScreen(hwnd: bigint, point: Point2D): Point2D {
  assertValidWindow(hwnd, "clientToScreen");

  const converted: win32.PointLike = { x: point.x, y: point.y };
  const succeeded = win32.clientToScreen(hwnd, converted);
  if (!succeeded) {
    throw new Error(
      `ClientToScreen falló para la ventana ${hwndToHexString(hwnd)}.`,
    );
  }

  return { x: converted.x, y: converted.y };
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulación de mouse y teclado (SetCursorPos + SendInput)
// ─────────────────────────────────────────────────────────────────────────────

/** Mueve el cursor a una posición absoluta de pantalla. */
export function setCursorPosition(point: Point2D): void {
  const succeeded = win32.setCursorPos(point.x, point.y);
  if (!succeeded) {
    throw new Error(
      `SetCursorPos falló en la posición (${point.x}, ${point.y}).`,
    );
  }
}

interface MouseInputArgs {
  dx?: number;
  dy?: number;
  flags: number;
}

/** Envía un evento de mouse mediante SendInput (método preferido sobre mouse_event). */
function sendMouseInput(args: MouseInputArgs): void {
  const input: win32.InputLike = {
    type: win32.INPUT_MOUSE,
    u: {
      mi: {
        dx: args.dx ?? 0,
        dy: args.dy ?? 0,
        mouseData: 0,
        dwFlags: args.flags,
        time: 0,
        dwExtraInfo: 0n,
      },
    },
  };

  const sent = win32.sendInput(1, input, win32.sizeofInput);
  if (sent !== 1) {
    throw new Error(
      `SendInput no pudo enviar el evento de mouse (flags=0x${args.flags.toString(16)}).`,
    );
  }
}

/** Presiona el botón izquierdo del mouse. */
export function mouseButtonDown(): void {
  sendMouseInput({ flags: win32.MOUSEEVENTF_LEFTDOWN });
}

/** Suelta el botón izquierdo del mouse. */
export function mouseButtonUp(): void {
  sendMouseInput({ flags: win32.MOUSEEVENTF_LEFTUP });
}

/** Clic izquierdo completo en una posición absoluta de pantalla. */
export async function clickAt(point: Point2D): Promise<void> {
  setCursorPosition(point);
  await sleep(40);
  mouseButtonDown();
  await sleep(40);
  mouseButtonUp();
}

/**
 * Mueve el cursor a coordenadas absolutas de pantalla usando SendInput con
 * MOUSEEVENTF_ABSOLUTE (normalizadas a 0-65535). Con MOUSEEVENTF_VIRTUALDESK
 * las coordenadas cubren todo el escritorio virtual (multi-monitor).
 */
export function mouseMoveAbsolute(point: Point2D): void {
  const virtualLeft = win32.getSystemMetrics(win32.SM_XVIRTUALSCREEN);
  const virtualTop = win32.getSystemMetrics(win32.SM_YVIRTUALSCREEN);
  const virtualWidth = win32.getSystemMetrics(win32.SM_CXVIRTUALSCREEN);
  const virtualHeight = win32.getSystemMetrics(win32.SM_CYVIRTUALSCREEN);

  const normalizedX = Math.round(
    ((point.x - virtualLeft) * 65535) / virtualWidth,
  );
  const normalizedY = Math.round(
    ((point.y - virtualTop) * 65535) / virtualHeight,
  );

  sendMouseInput({
    dx: normalizedX,
    dy: normalizedY,
    flags:
      win32.MOUSEEVENTF_MOVE |
      win32.MOUSEEVENTF_ABSOLUTE |
      win32.MOUSEEVENTF_VIRTUALDESK,
  });
}

/**
 * Simula un arrastre del mouse a través de una serie de puntos (polilínea):
 *  1. Salta al primer punto (SetCursorPos).
 *  2. Presiona el botón izquierdo.
 *  3. Avanza por cada punto con SendInput absoluto (más fiables que el
 *     movimiento relativo), con un pequeño retraso opcional entre puntos.
 *  4. Suelta el botón izquierdo (también en caso de error, con finally).
 *
 * Las coordenadas deben ser absolutas de pantalla. Requiere al menos 2 puntos.
 */
export async function dragPolyline(
  points: Point2D[],
  stepDelayMs: number,
): Promise<void> {
  if (points.length < 2) {
    throw new Error("dragPolyline necesita al menos 2 puntos.");
  }

  setCursorPosition(points[0]);
  await sleep(60);

  mouseButtonDown();
  try {
    for (let i = 1; i < points.length; i++) {
      mouseMoveAbsolute(points[i]);
      if (stepDelayMs > 0) {
        await sleep(stepDelayMs);
      }
    }
  } finally {
    mouseButtonUp();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Procesos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lanza una aplicación por nombre (resuelto por Windows, sin rutas absolutas).
 * `stdio: "ignore"` evita abrir una consola adicional y `windowsHide` evita
 * cualquier ventana de consola transitoria.
 */
export function spawnApplication(
  executable: string,
  args: string[] = [],
): number {
  const child = spawn(executable, args, {
    stdio: "ignore",
    windowsHide: true,
    detached: false,
  });

  child.on("error", (error: Error) => {
    console.error(
      `[windows/process] No se pudo iniciar "${executable}": ${error.message}`,
    );
  });

  if (child.pid === undefined) {
    throw new Error(`No se pudo iniciar "${executable}".`);
  }

  child.unref();
  return child.pid;
}

/**
 * Lanza una aplicación UWP/desktop por AUMID mediante ShellExecuteW
 * (el verbo "open" sobre un AUMID crea una instancia nueva de la app).
 * Es el mecanismo nativo de Windows para arrancar una instancia nueva de
 * una app empaquetada (AppsFolder); no hay que pasar por explorer.exe.
 * Lanza un error si la llamada Win32 falla.
 */
export function shellExecuteApp(aumid: string): void {
  const result = shell.shellExecuteW(
    0n,
    "open",
    aumid,
    null,
    null,
    shell.SW_SHOWNORMAL,
  );

  if (result === null || result <= 32n) {
    throw new Error(
      `ShellExecuteW falló al lanzar la aplicación "${aumid}".`,
    );
  }
}
