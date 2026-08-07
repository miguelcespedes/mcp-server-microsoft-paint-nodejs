/**
 * Bindings de la API Win32 (user32.dll) mediante Koffi.
 *
 * Este módulo contiene ÚNICAMENTE:
 *  - Definición de tipos nativos (HWND, BOOL, DWORD, POINT, RECT, INPUT...).
 *  - Declaración de las funciones cargadas desde user32.dll.
 *  - Constantes de la API.
 *
 * Toda la lógica de negocio vive fuera de aquí (ver windows/process.ts).
 */

import koffi from "koffi";

export const user32 = koffi.load("user32.dll");

// ─────────────────────────────────────────────────────────────────────────────
// Tipos nativos
// ─────────────────────────────────────────────────────────────────────────────
//
// En Windows de 64 bits los handles y punteros tienen 64 bits. Koffi 3 los
// representa como valores BigInt de JavaScript, por lo que no hay pérdida de
// precisión. Nunca se deben tratar como number ordinarios.

/** HANDLE: puntero opaco de tamaño nativo (void *). */
export const HANDLE = koffi.pointer("HANDLE", koffi.opaque());

/** HWND: alias de HANDLE, usado por las funciones de ventanas. */
export const HWND = koffi.alias("HWND", HANDLE);

// ─────────────────────────────────────────────────────────────────────────────
// Conciencia DPI (obligatorio)
// ─────────────────────────────────────────────────────────────────────────────
//
// Por defecto los procesos Node/.NET se marcan como "DPI-unaware" y Windows
// VIRTUALIZA sus coordenadas de pantalla (escaladas según el DPI del monitor,
// p. ej. ×1.25 en un monitor al 125%). Eso rompe la correspondencia con las
// posiciones medidas (UIA, coordenadas físicas) y con SetCursorPos.
// Se declara conciencia DPI por monitor (Win10 1703+) ANTES de cualquier
// otra llamada de GUI para que todas las coordenadas sean físicas.

const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4n; // (HANDLE)-4
export const setProcessDpiAwarenessContext = user32.func(
  "bool __stdcall SetProcessDpiAwarenessContext(HANDLE value)",
) as unknown as (value: bigint) => boolean;

/** Fija la conciencia DPI por monitor (V2) para este proceso. */
export function enablePerMonitorDpiAwareness(): void {
  setProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  // Si devuelve false es porque el contexto ya está fijado por el host
  // (ERROR_ACCESS_DENIED), lo cual también es válido.
}

enablePerMonitorDpiAwareness();

/** BOOL: entero de 32 bits (0 = false, distinto de 0 = true). */
/** DWORD: entero sin signo de 32 bits. */
export const DWORD = koffi.alias("DWORD", "uint32_t");

/** UINT: entero sin signo de 32 bits. */
export const UINT = koffi.alias("UINT", "uint32_t");

/** LONG: entero con signo de 32 bits (Windows). */
export const LONG = koffi.alias("LONG", "int32_t");

/** LPARAM: LONG_PTR (64 bits en x64), se usa como parámetro genérico. */
export const LPARAM = koffi.alias("LPARAM", "intptr");

/** POINT: coordenadas { x, y } de 32 bits. */
export const POINT = koffi.struct("POINT", { x: LONG, y: LONG });

/** RECT: rectángulo { left, top, right, bottom } de 32 bits. */
export const RECT = koffi.struct("RECT", {
  left: LONG,
  top: LONG,
  right: LONG,
  bottom: LONG,
});

/**
 * MOUSEINPUT: parte de la unión INPUT de SendInput.
 * En x64: dx(4) + dy(4) + mouseData(4) + dwFlags(4) + time(4) + pad(4) + dwExtraInfo(8) = 32 bytes.
 */
export const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
  dx: LONG,
  dy: LONG,
  mouseData: UINT,
  dwFlags: UINT,
  time: UINT,
  dwExtraInfo: "uintptr",
});

/**
 * KEYBDINPUT: miembro de la unión INPUT para eventos de teclado.
 * En x64: wVk(2) + wScan(2) + dwFlags(4) + time(4) + pad(4) + dwExtraInfo(8) = 24 bytes.
 */
export const KEYBDINPUT = koffi.struct("KEYBDINPUT", {
  wVk: "uint16",
  wScan: "uint16",
  dwFlags: "uint32",
  time: "uint32",
  dwExtraInfo: "uintptr",
});

/**
 * INPUTUNION: la unión de INPUT (mi = mouse, ki = teclado, hi = hardware).
 * Solo declaramos los miembros que usamos; el tamaño lo marca el mayor.
 */
export const INPUTUNION = koffi.union("INPUTUNION", {
  mi: MOUSEINPUT,
  ki: KEYBDINPUT,
});

/**
 * INPUT: la estructura que recibe SendInput.
 * En x64: type(4) + pad(4) + unión(32) = 40 bytes.
 */
export const INPUT = koffi.struct("INPUT", { type: UINT, u: INPUTUNION });

/** Tamaño en bytes de INPUT, requerido por SendInput como cbSize. */
export const sizeofInput = koffi.sizeof(INPUT);

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

/** Muestra la ventana y la restaura si está minimizada. */
export const SW_SHOW = 5;
/** Restaura la ventana (sin activarla necesariamente). */
export const SW_RESTORE = 9;
/** Maximiza la ventana. */
export const SW_MAXIMIZE = 3;

/** Flags de SetWindowPos. */
export const SWP_NOSIZE = 0x0001;
export const SWP_NOZORDER = 0x0004;
export const SWP_NOACTIVATE = 0x0010;
export const SWP_SHOWWINDOW = 0x0040;

/** Tipo de evento INPUT_MOUSE para SendInput. */
export const INPUT_MOUSE = 0;
/** Tipo de evento INPUT_KEYBOARD para SendInput. */
export const INPUT_KEYBOARD = 1;

/** MOUSEEVENTF_MOVE: movimiento relativo del cursor. */
export const MOUSEEVENTF_MOVE = 0x0001;
/** MOUSEEVENTF_LEFTDOWN: botón izquierdo presionado. */
export const MOUSEEVENTF_LEFTDOWN = 0x0002;
/** MOUSEEVENTF_LEFTUP: botón izquierdo liberado. */
export const MOUSEEVENTF_LEFTUP = 0x0004;
/** MOUSEEVENTF_ABSOLUTE: dx/dy son coordenadas absolutas normalizadas (0-65535). */
export const MOUSEEVENTF_ABSOLUTE = 0x8000;
/** MOUSEEVENTF_VIRTUALDESK: las coordenadas absolutas cubren todo el escritorio virtual. */
export const MOUSEEVENTF_VIRTUALDESK = 0x4000;

/** KEYEVENTF_KEYUP: liberación de tecla. */
export const KEYEVENTF_KEYUP = 0x0002;

/** Códigos de tecla virtual comunes. */
export const VK_CONTROL = 0x11;
export const VK_HOME = 0x24;
export const VK_RETURN = 0x0d;
export const VK_DOWN = 0x28;
export const VK_ESCAPE = 0x1b;
export const VK_E = 0x45;
export const VK_P = 0x50;

/** Índices de GetSystemMetrics para el escritorio virtual (multi-monitor). */
export const SM_CXSCREEN = 0;
export const SM_CYSCREEN = 1;
export const SM_XVIRTUALSCREEN = 76;
export const SM_YVIRTUALSCREEN = 77;
export const SM_CXVIRTUALSCREEN = 78;
export const SM_CYVIRTUALSCREEN = 79;

// ─────────────────────────────────────────────────────────────────────────────
// Firmas tipadas usadas para tipar los bindings
// ─────────────────────────────────────────────────────────────────────────────

/** Callback de EnumWindows. Recibe el HWND y el LPARAM como BigInt. */
export type EnumWindowsProc = (hwnd: bigint, lParam: bigint) => boolean;

export interface PointLike {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MouseInputLike {
  dx: number;
  dy: number;
  mouseData: number;
  dwFlags: number;
  time: number;
  dwExtraInfo: bigint;
}

export interface KeyboardInputLike {
  wVk: number;
  wScan: number;
  dwFlags: number;
  time: number;
  dwExtraInfo: bigint;
}

export interface InputLike {
  type: number;
  u: { mi: MouseInputLike } | { ki: KeyboardInputLike };
}

// ─────────────────────────────────────────────────────────────────────────────
// Declaración de funciones de user32.dll
// ─────────────────────────────────────────────────────────────────────────────

export const EnumWindowsProcType = koffi.proto(
  "bool __stdcall EnumWindowsProc(HWND hwnd, LPARAM lParam)",
);

/** Enumerar todas las ventanas de nivel superior. */
export const enumWindows = user32.func(
  "bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, LPARAM lParam)",
) as unknown as (
  callback: EnumWindowsProc,
  lParam: bigint | number,
) => boolean;

/** Buscar una ventana por clase y/o título (acepta null en ambos). */
export const findWindowW = user32.func(
  "HWND __stdcall FindWindowW(const char16_t *lpClassName, const char16_t *lpWindowName)",
) as unknown as (className: string | null, windowName: string | null) => bigint;

/** Leer el título de una ventana (UTF-16). Escribe en el buffer y devuelve los caracteres copiados. */
export const getWindowTextW = user32.func(
  "int __stdcall GetWindowTextW(HWND hWnd, _Out_ char16_t *lpString, int nMaxCount)",
) as unknown as (hwnd: bigint, buffer: Buffer, maxCount: number) => number;

/** Leer el nombre de clase de una ventana (UTF-16). */
export const getClassNameW = user32.func(
  "int __stdcall GetClassNameW(HWND hWnd, _Out_ char16_t *lpClassName, int nMaxCount)",
) as unknown as (hwnd: bigint, buffer: Buffer, maxCount: number) => number;

/** Devuelve el PID del proceso dueño de la ventana (escribe en un arreglo de 1 elemento). */
export const getWindowThreadProcessId = user32.func(
  "DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)",
) as unknown as (hwnd: bigint, pidOut: Array<number | null>) => number;

/** Devuelve el HWND de la ventana en primer plano (0 si no hay ninguna). */
export const getForegroundWindow = user32.func(
  "HWND __stdcall GetForegroundWindow()",
) as unknown as () => bigint;

/**
 * Adjunta/destaca los mecanismos de entrada de dos hilos; se usa para
 * eludir la restricción de SetForegroundWindow en ventanas de otros
 * procesos.
 */
export const attachThreadInput = user32.func(
  "bool __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)",
) as unknown as (
  idAttach: number,
  idAttachTo: number,
  fAttach: boolean,
) => boolean;

/** Comprueba si el HWND corresponde a una ventana existente. */
export const isWindow = user32.func(
  "bool __stdcall IsWindow(HWND hWnd)",
) as unknown as (hwnd: bigint) => boolean;

/** Comprueba si la ventana es visible. */
export const isWindowVisible = user32.func(
  "bool __stdcall IsWindowVisible(HWND hWnd)",
) as unknown as (hwnd: bigint) => boolean;

/** Comprueba si la ventana está minimizada (iconizada). */
export const isIconic = user32.func(
  "bool __stdcall IsIconic(HWND hWnd)",
) as unknown as (hwnd: bigint) => boolean;

/** Comprueba si la ventana está maximizada. */
export const isZoomed = user32.func(
  "bool __stdcall IsZoomed(HWND hWnd)",
) as unknown as (hwnd: bigint) => boolean;

/** Intenta llevar la ventana al primer plano. */
export const setForegroundWindow = user32.func(
  "bool __stdcall SetForegroundWindow(HWND hWnd)",
) as unknown as (hwnd: bigint) => boolean;

/** Muestra/oculta/restaura la ventana según nCmdShow. */
export const showWindow = user32.func(
  "bool __stdcall ShowWindow(HWND hWnd, int nCmdShow)",
) as unknown as (hwnd: bigint, nCmdShow: number) => boolean;

/** Reproduce el sonido del sistema asociado al tipo indicado. */
export const messageBeep = user32.func(
  "bool __stdcall MessageBeep(uint32_t uType)",
) as unknown as (uType: number) => boolean;

/** Reubica/redimensiona la ventana. */
export const setWindowPos = user32.func(
  "bool __stdcall SetWindowPos(HWND hWnd, HWND hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)",
) as unknown as (
  hwnd: bigint,
  hwndInsertAfter: bigint,
  x: number,
  y: number,
  cx: number,
  cy: number,
  flags: number,
) => boolean;

/** Obtiene el rectángulo del área cliente de la ventana. */
export const getClientRect = user32.func(
  "bool __stdcall GetClientRect(HWND hWnd, _Out_ RECT *lpRect)",
) as unknown as (hwnd: bigint, rect: RectLike) => boolean;

/** Obtiene el rectángulo exterior de la ventana en coordenadas de pantalla. */
export const getWindowRect = user32.func(
  "bool __stdcall GetWindowRect(HWND hWnd, _Out_ RECT *lpRect)",
) as unknown as (hwnd: bigint, rect: RectLike) => boolean;

/** Convierte coordenadas del área cliente a coordenadas absolutas de pantalla (in/out). */
export const clientToScreen = user32.func(
  "bool __stdcall ClientToScreen(HWND hWnd, _Inout_ POINT *lpPoint)",
) as unknown as (hwnd: bigint, point: PointLike) => boolean;

/** Mueve el cursor a coordenadas absolutas de pantalla. */
export const setCursorPos = user32.func(
  "bool __stdcall SetCursorPos(int X, int Y)",
) as unknown as (x: number, y: number) => boolean;

/** Obtiene métricas del sistema (resoluciones, coordenadas del escritorio virtual, etc.). */
export const getSystemMetrics = user32.func(
  "int __stdcall GetSystemMetrics(int nIndex)",
) as unknown as (nIndex: number) => number;

/** Inyecta eventos de entrada sintéticos (mouse, teclado, hardware). */
export const sendInput = user32.func(
  "UINT __stdcall SendInput(UINT cInputs, INPUT *pInputs, int cbSize)",
) as unknown as (
  cInputs: number,
  pInputs: InputLike | InputLike[],
  cbSize: number,
) => number;
