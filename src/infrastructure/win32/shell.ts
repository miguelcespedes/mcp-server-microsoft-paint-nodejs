/**
 * Bindings de shell32.dll mediante Koffi.
 *
 * Este módulo contiene ÚNICAMENTE:
 *  - Definición de handles nativos.
 *  - Declaración de funciones cargadas desde shell32.dll.
 *
 * Toda la lógica de negocio vive fuera de aquí (ver process.ts).
 */

import koffi from "koffi";

export const shell32 = koffi.load("shell32.dll");

/** HANDLE genérico de shell32 (void *). */
export const HANDLE = koffi.pointer("SHELL_HANDLE", koffi.opaque());

/** HWND/HINSTANCE: handles opacos de tamaño nativo. */
export const HWND = koffi.alias("SHELL_HWND", HANDLE);
export const HINSTANCE = koffi.alias("SHELL_HINSTANCE", HANDLE);

/** SW_SHOWNORMAL: muestra la ventana de la app lanzada. */
export const SW_SHOWNORMAL = 1;

/**
 * ShellExecuteW: abre un recurso o aplicación a través del shell de Windows.
 *
 * Para Paint moderno en Windows 11 se usa con el AUMID
 * `shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App`, evitando pasar por
 * explorer.exe y sin necesidad de atajos de teclado.
 *
 * Devuelve un HINSTANCE. Valores <= 32 indican error.
 */
export const shellExecuteW = shell32.func(
  "__stdcall",
  "ShellExecuteW",
  HINSTANCE,
  [HWND, "str16", "str16", "str16", "str16", "int32_t"],
) as unknown as (
  hwnd: bigint | null,
  operation: string | null,
  file: string | null,
  parameters: string | null,
  directory: string | null,
  nShowCmd: number,
) => bigint | null;
