/**
 * Lógica genérica de Windows: procesos y ventanas.
 *
 * No conoce nada específico de Paint: aquí viven los helpers reutilizables
 * para lanzar procesos, enumerar ventanas, traerlas al primer plano y
 * simular el mouse con Win32.
 */

import { spawn } from "node:child_process";
import type { Logger } from "../logging/logger.js";
import { PaintMcpError } from "../errors/paint-mcp-error.js";
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

export interface Rectangle2D {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface MonitorInfo {
  left: number;
  top: number;
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

export interface EnsureWindowReadyOptions {
  maximize?: boolean;
  foreground?: boolean;
  stableReadings?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  readyGraceMs?: number;
  foregroundAttempts?: number;
  logger?: Logger;
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

/** Obtiene el HWND de la ventana actualmente en foreground. */
export function getForegroundWindowHandle(): bigint {
  return win32.getForegroundWindow();
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

/** Tamaño del monitor primario según GetSystemMetrics. */
export function getPrimaryMonitorInfo(): MonitorInfo {
  return {
    left: 0,
    top: 0,
    width: win32.getSystemMetrics(win32.SM_CXSCREEN),
    height: win32.getSystemMetrics(win32.SM_CYSCREEN),
  };
}

/** Mueve la ventana al monitor primario antes de maximizarla. */
export function moveWindowToPrimaryMonitor(hwnd: bigint): boolean {
  assertValidWindow(hwnd, "moveWindowToPrimaryMonitor");
  const monitor = getPrimaryMonitorInfo();
  return Boolean(
    win32.setWindowPos(
      hwnd,
      0n,
      monitor.left,
      monitor.top,
      monitor.width,
      monitor.height,
      win32.SWP_NOZORDER | win32.SWP_NOACTIVATE | win32.SWP_SHOWWINDOW,
    ),
  );
}

/** Comprueba si la ventana está maximizada. */
export function isWindowMaximized(hwnd: bigint): boolean {
  assertValidWindow(hwnd, "isWindowMaximized");
  return Boolean(win32.isZoomed(hwnd));
}

/** Comprueba si la ventana está minimizada (iconizada). */
export function isWindowMinimized(hwnd: bigint): boolean {
  assertValidWindow(hwnd, "isWindowMinimized");
  return Boolean(win32.isIconic(hwnd));
}

/** Obtiene el rectángulo exterior de la ventana en coordenadas de pantalla. */
export function getWindowRect(hwnd: bigint): Rectangle2D {
  assertValidWindow(hwnd, "getWindowRect");

  const rect: win32.RectLike = { left: 0, top: 0, right: 0, bottom: 0 };
  const succeeded = win32.getWindowRect(hwnd, rect);
  if (!succeeded) {
    throw new Error(
      `GetWindowRect falló para la ventana ${hwndToHexString(hwnd)}.`,
    );
  }

  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

/**
 * Geometría del monitor que contiene la ventana (o el más cercano si la
 * ventana está fuera de todos los monitores). A diferencia de
 * getPrimaryMonitorInfo(), esto refleja el monitor REAL en el que vive la
 * ventana, imprescindible en configuraciones multi-monitor.
 */
export function getWindowMonitorInfo(hwnd: bigint): Rectangle2D {
  assertValidWindow(hwnd, "getWindowMonitorInfo");

  const hMonitor = win32.monitorFromWindow(hwnd, win32.MONITOR_DEFAULTTONEAREST);
  const info: win32.MonitorInfoLike = {
    cbSize: win32.sizeofMonitorInfo,
    rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
    rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
    dwFlags: 0,
  };

  const succeeded = win32.getMonitorInfoW(hMonitor, info);
  if (!succeeded) {
    throw new Error(
      `GetMonitorInfoW falló para la ventana ${hwndToHexString(hwnd)}.`,
    );
  }

  const rect = info.rcMonitor;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

/** Exportado para pruebas unitarias puras sin depender de llamadas Win32 reales. */
export function rectsIntersect(a: Rectangle2D, b: Rectangle2D): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * True si la ventana se solapa con el monitor que Windows considera más
 * cercano a ella. False indica que la ventana está posicionada fuera de
 * cualquier área de escritorio visible (p. ej. tras desconectar un monitor
 * secundario), lo que hace inútil cualquier automatización de mouse sobre
 * ella aunque no esté minimizada.
 */
export function isWindowOnVisibleMonitor(hwnd: bigint): boolean {
  const windowRect = getWindowRect(hwnd);
  const monitorRect = getWindowMonitorInfo(hwnd);
  return rectsIntersect(windowRect, monitorRect);
}

function areRectsEqual(left: Rectangle2D, right: Rectangle2D): boolean {
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom
  );
}

function areSizesEqual(left: Size2D, right: Size2D): boolean {
  return left.width === right.width && left.height === right.height;
}

/**
 * Espera a que el rectángulo de la ventana permanezca estable durante varias
 * lecturas consecutivas. Evita depender solo de un sleep fijo para saber si
 * Paint ya terminó de recalcular el layout tras restaurar/maximizar.
 */
export async function waitForStableWindowRect(
  hwnd: bigint,
  stableReadings: number,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<Rectangle2D> {
  assertValidWindow(hwnd, "waitForStableWindowRect");

  const deadline = Date.now() + timeoutMs;
  let lastRect = getWindowRect(hwnd);
  let stableCount = 1;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const rect = getWindowRect(hwnd);
    if (areRectsEqual(lastRect, rect)) {
      stableCount += 1;
      if (stableCount >= stableReadings) {
        return rect;
      }
    } else {
      stableCount = 1;
      lastRect = rect;
    }
  }

  throw new Error(
    `La ventana ${hwndToHexString(hwnd)} no estabilizó su rectángulo tras ${timeoutMs} ms.`,
  );
}

/**
 * Espera a que el tamaño del área cliente también se estabilice. En Paint
 * moderno, el HWND puede quedar estable unos instantes antes de que termine
 * el recálculo interno del ribbon y del canvas.
 */
export async function waitForStableClientSize(
  hwnd: bigint,
  stableReadings: number,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<Size2D> {
  assertValidWindow(hwnd, "waitForStableClientSize");

  const deadline = Date.now() + timeoutMs;
  let lastSize = getClientSize(hwnd);
  let stableCount = 1;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const size = getClientSize(hwnd);
    if (areSizesEqual(lastSize, size)) {
      stableCount += 1;
      if (stableCount >= stableReadings) {
        return size;
      }
    } else {
      stableCount = 1;
      lastSize = size;
    }
  }

  throw new Error(
    `La ventana ${hwndToHexString(hwnd)} no estabilizó su área cliente tras ${timeoutMs} ms.`,
  );
}

/**
 * Normaliza el estado de la ventana de Paint antes de inventariar UIA o dibujar:
 * restaura si está minimizada, maximiza, lleva al foreground, verifica foco
 * real y espera a que el layout se estabilice.
 */
export async function ensureWindowReady(
  hwnd: bigint,
  options: EnsureWindowReadyOptions = {},
): Promise<Rectangle2D> {
  assertValidWindow(hwnd, "ensureWindowReady");

  const {
    maximize = true,
    foreground = true,
    stableReadings = 3,
    timeoutMs = 4_000,
    pollIntervalMs = 150,
    readyGraceMs = 1_000,
    foregroundAttempts = 5,
    logger,
  } = options;

  logger?.debug("Paint window initial state", {
    hwnd: hwndToHexString(hwnd),
    iconic: Boolean(win32.isIconic(hwnd)),
    zoomed: Boolean(win32.isZoomed(hwnd)),
    rect: getWindowRect(hwnd),
    primaryMonitor: getPrimaryMonitorInfo(),
  });

  if (win32.isIconic(hwnd)) {
    win32.showWindow(hwnd, win32.SW_RESTORE);
    logger?.debug("Paint window restored from minimized state", {
      hwnd: hwndToHexString(hwnd),
    });
  }

  if (maximize && !win32.isZoomed(hwnd)) {
    maximizeWindow(hwnd);
    logger?.debug("Paint window maximized", {
      hwnd: hwndToHexString(hwnd),
    });
  }

  if (!isWindowOnVisibleMonitor(hwnd)) {
    const rect = getWindowRect(hwnd);
    throw new PaintMcpError(
      "PAINT_WINDOW_NOT_VISIBLE",
      "La ventana de Paint está posicionada fuera de cualquier monitor " +
        "activo, por lo que dibujar en ella no producirá ningún resultado " +
        "visible (esto ocurre p. ej. si se desconectó un monitor secundario " +
        "donde estaba la ventana).",
      { hwnd: hwndToHexString(hwnd), rect },
    );
  }

  if (foreground) {
    const focus = await bringWindowToFront(hwnd);
    logger?.debug("Paint window foreground request finished", {
      hwnd: hwndToHexString(hwnd),
      success: focus.success,
      warning: focus.warning,
    });
    if (!focus.success) {
      throw new Error(
        focus.warning ?? "Windows no permitió traer Paint al foreground.",
      );
    }
  }

  let foregroundHwnd = getForegroundWindowHandle();
  logger?.debug("Foreground HWND after normalization", {
    expected: hwndToHexString(hwnd),
    actual: hwndToHexString(foregroundHwnd),
  });
  if (foreground && foregroundHwnd !== hwnd) {
    let matchedForeground = false;
    for (let attempt = 1; attempt <= foregroundAttempts; attempt += 1) {
      await sleep(120);
      await bringWindowToFront(hwnd);
      await sleep(120);
      foregroundHwnd = getForegroundWindowHandle();
      logger?.debug("Foreground retry after normalization", {
        attempt,
        expected: hwndToHexString(hwnd),
        actual: hwndToHexString(foregroundHwnd),
      });
      if (foregroundHwnd === hwnd) {
        matchedForeground = true;
        break;
      }
    }

    if (!matchedForeground) {
      throw new Error(
        `La ventana activa no es Paint tras la normalización (${hwndToHexString(foregroundHwnd)}).`,
      );
    }
  }

  const rect = await waitForStableWindowRect(
    hwnd,
    stableReadings,
    timeoutMs,
    pollIntervalMs,
  );
  const clientSize = await waitForStableClientSize(
    hwnd,
    stableReadings,
    timeoutMs,
    pollIntervalMs,
  );
  if (readyGraceMs > 0) {
    await sleep(readyGraceMs);
  }
  logger?.debug("Paint window stabilized", {
    hwnd: hwndToHexString(hwnd),
    rect,
    clientSize,
    readyGraceMs,
  });

  return rect;
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

function sendKeyboardEvent(vk: number, keyUp: boolean): void {
  const input: win32.InputLike = {
    type: win32.INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: vk,
        wScan: 0,
        dwFlags: keyUp ? win32.KEYEVENTF_KEYUP : 0,
        time: 0,
        dwExtraInfo: 0n,
      },
    },
  };

  const sent = win32.sendInput(1, input, win32.sizeofInput);
  if (sent !== 1) {
    throw new Error(
      `SendInput no pudo enviar el evento de teclado (VK=0x${vk.toString(16)}, keyUp=${keyUp}).`,
    );
  }
}

export function pressKey(vk: number): void {
  sendKeyboardEvent(vk, false);
  sendKeyboardEvent(vk, true);
}

export function pressKeyCombo(modifiers: number[], vk: number): void {
  for (const modifier of modifiers) {
    sendKeyboardEvent(modifier, false);
  }
  sendKeyboardEvent(vk, false);
  sendKeyboardEvent(vk, true);
  for (const modifier of [...modifiers].reverse()) {
    sendKeyboardEvent(modifier, true);
  }
}

/**
 * Ejecuta una "KeyTip" de la cinta: pulsa y SUELTA Alt (a diferencia de
 * pressKeyCombo, que lo mantiene presionado como modificador) para activar
 * las guías de acceso de teclado de Windows, y luego pulsa la letra
 * indicada como una tecla independiente. A diferencia de un atajo directo
 * de una sola letra, esto cubre CUALQUIER control de la cinta (incluidos
 * split-buttons como "Pinceles"/Brocha, cuyo InvokePattern vía UI
 * Automation solo abre su flyout en vez de aplicar la herramienta): la
 * KeyTip sí invoca la acción primaria real, igual que un usuario
 * presionando Alt y luego la letra.
 */
export async function pressKeyTip(vk: number, delayMs = 250): Promise<void> {
  sendKeyboardEvent(win32.VK_MENU, false);
  sendKeyboardEvent(win32.VK_MENU, true);
  await sleep(delayMs);
  sendKeyboardEvent(vk, false);
  sendKeyboardEvent(vk, true);
}

/**
 * Como pressKeyTip, pero para navegar una cadena de KeyTips de varios
 * pasos (p. ej. Alt → J → T para abrir la pestaña contextual "Herramientas
 * de texto", seguido de F → S para saltar al cuadro de tamaño de fuente):
 * Alt se pulsa y suelta UNA sola vez para entrar en modo KeyTip, y luego
 * cada tecla de la secuencia se pulsa por separado — el ribbon va
 * revelando las KeyTips del siguiente nivel a medida que se selecciona
 * cada pestaña/grupo, sin necesidad de volver a pulsar Alt entre pasos.
 */
export async function pressKeyTipSequence(keys: number[], delayMs = 250): Promise<void> {
  sendKeyboardEvent(win32.VK_MENU, false);
  sendKeyboardEvent(win32.VK_MENU, true);
  await sleep(delayMs);
  for (const vk of keys) {
    sendKeyboardEvent(vk, false);
    sendKeyboardEvent(vk, true);
    await sleep(delayMs);
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

/**
 * Clic izquierdo completo en una posición absoluta de pantalla. Posiciona
 * el cursor vía SendInput (mouseMoveAbsolute), no SetCursorPos: ver el
 * comentario en dragPolyline sobre por qué mezclar ambos mecanismos puede
 * hacer que apps WinUI3/XAML no registren el clic en la posición esperada.
 */
export async function clickAt(point: Point2D): Promise<void> {
  mouseMoveAbsolute(point);
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

  // Todo el gesto (posición inicial, botón, movimientos) debe inyectarse
  // vía SendInput, NO mezclar con SetCursorPos: son mecanismos de entrada
  // distintos, y apps WinUI3/XAML como el Paint moderno correlacionan el
  // mouse-down con la posición reportada por el flujo de SendInput. Si el
  // punto inicial se coloca con SetCursorPos, el cursor se ve moverse pero
  // el botón puede registrarse en una posición no sincronizada, y Paint no
  // llega a interpretar un trazo real (aunque el cursor recorra la ruta
  // completa en pantalla).
  mouseMoveAbsolute(points[0]);
  await sleep(60);

  mouseButtonDown();
  try {
    // Paint puede tardar un instante en comenzar realmente el trazo tras el
    // mouse-down; este pequeño dwell evita que se pierda el segmento inicial.
    await sleep(90);

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

/**
 * Gesto de arrastre simple para herramientas nativas de formas de Paint.
 *
 * A diferencia de dragPolyline(), aquí no intentamos seguir una trayectoria
 * compleja. Paint solo necesita el rectángulo delimitador de la forma:
 * punto inicial + punto final con el botón presionado.
 */
export async function dragShapeBounds(
  start: Point2D,
  end: Point2D,
  durationMs: number,
): Promise<void> {
  if (durationMs < 50 || durationMs > 5_000) {
    throw new Error(
      `dragShapeBounds requiere durationMs entre 50 y 5000 (recibido: ${durationMs}).`,
    );
  }

  mouseMoveAbsolute(start);
  await sleep(80);

  mouseButtonDown();
  try {
    // Darle tiempo a Paint para entrar en modo de creación de shape.
    await sleep(120);

    // Pequeño movimiento inicial: algunas herramientas nativas de shapes no
    // comienzan a crear la figura hasta que detectan un desplazamiento real
    // tras el mouse-down.
    const kickoff = {
      x: start.x + Math.sign(end.x - start.x || 1),
      y: start.y + Math.sign(end.y - start.y || 1),
    };
    mouseMoveAbsolute(kickoff);
    await sleep(80);

    // Para shapes nativas de Paint, el rectángulo delimitador suele responder
    // mejor a movimientos absolutos inyectados mientras el botón permanece
    // abajo, siempre que haya un pequeño desplazamiento inicial de arranque.
    const steps = Math.max(6, Math.min(24, Math.round(durationMs / 40)));
    for (let i = 1; i <= steps; i += 1) {
      mouseMoveAbsolute({
        x: Math.round(kickoff.x + ((end.x - kickoff.x) * i) / steps),
        y: Math.round(kickoff.y + ((end.y - kickoff.y) * i) / steps),
      });
      await sleep(Math.max(12, Math.round(durationMs / steps)));
    }

    // Mantener un instante el mouse en el punto final antes de soltar ayuda
    // a que Paint consolide la shape creada.
    await sleep(140);
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
 * Termina un proceso por PID (taskkill /F). Se usa para limpiar los stubs de
 * mspaint.exe de Windows 11 que quedan vivos sin ventana cuando el lanzamiento
 * de Paint termina resolviéndose por ShellExecuteW. Los errores se ignoran:
 * el proceso pudo ya haber salido o pertenecer a otra sesión.
 */
export function killProcess(pid: number): void {
  const killer = spawn("taskkill", ["/PID", String(pid), "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  killer.on("error", () => {
    // Sin destino: el proceso ya no existe. Nada que hacer.
  });
  killer.unref();
}

/**
 * Escribe texto mediante SendInput (teclado virtual).
 * Convierte cada carácter a eventos de teclado.
 */
export async function typeText(text: string): Promise<void> {
  const { sendInput, INPUT_KEYBOARD, KEYEVENTF_KEYUP, VK_SPACE, VK_TAB, VK_BACK, VK_RETURN, VK_ESCAPE } = await import("./user32.js");

  const inputs: Array<{ type: number; u: { ki: { wVk: number; wScan: number; dwFlags: number; time: number; dwExtraInfo: bigint } } }> = [];

  for (const char of text) {
    const vk = charToVirtualKey(char);
    if (vk === 0) continue;

    // Key down
    inputs.push({
      type: INPUT_KEYBOARD,
      u: {
        ki: {
          wVk: vk,
          wScan: 0,
          dwFlags: 0,
          time: 0,
          dwExtraInfo: 0n,
        },
      },
    });

    // Key up
    inputs.push({
      type: INPUT_KEYBOARD,
      u: {
        ki: {
          wVk: vk,
          wScan: 0,
          dwFlags: KEYEVENTF_KEYUP,
          time: 0,
          dwExtraInfo: 0n,
        },
      },
    });
  }

  if (inputs.length > 0) {
    sendInput(inputs.length, inputs, 40); // 40 = sizeof(INPUT) on x64
    await sleep(50);
  }
}

function charToVirtualKey(char: string): number {
  const code = char.charCodeAt(0);
  // ASCII letters
  if (code >= 65 && code <= 90) return code; // A-Z
  if (code >= 97 && code <= 122) return code - 32; // a-z -> A-Z (shift handled separately)
  // Digits
  if (code >= 48 && code <= 57) return code; // 0-9
  // Space
  if (code === 32) return 0x20; // VK_SPACE
  // Enter
  if (code === 10) return 0x0d; // VK_RETURN
  // Tab
  if (code === 9) return 0x09; // VK_TAB
  // Backspace
  if (code === 8) return 0x08; // VK_BACK
  // Escape
  if (code === 27) return 0x1b; // VK_ESCAPE
  // Common punctuation (simplified - would need shift for many)
  const punctuation: Record<string, number> = {
    ".": 0xBE, // VK_OEM_PERIOD
    ",": 0xBC, // VK_OEM_COMMA
    "?": 0xBF, // VK_OEM_2
    "!": 0x31, // 1 with shift
    "@": 0x32, // 2 with shift
    "#": 0x33,
    $: 0x34,
    "%": 0x35,
    "^": 0x36,
    "&": 0x37,
    "*": 0x38,
    "(": 0x39,
    ")": 0x30,
    "-": 0xBD, // VK_OEM_MINUS
    "=": 0xBB, // VK_OEM_PLUS
    "[": 0xDB, // VK_OEM_4
    "]": 0xDD, // VK_OEM_6
    "\\": 0xDC, // VK_OEM_5
    ";": 0xBA, // VK_OEM_1
    "'": 0xDE, // VK_OEM_7
    "`": 0xC0, // VK_OEM_3
  };
  return punctuation[char] ?? 0;
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

/** Alerta sonora no intrusiva para indicar que una operación terminó. */
export function notifyOperationFinished(): void {
  try {
    win32.messageBeep(0xffffffff);
  } catch {
    // No interrumpir la operación si el beep falla.
  }
}
