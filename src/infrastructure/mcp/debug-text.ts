export function debugResultText(summary: string, result: unknown): string {
  return `${summary}\n\n${JSON.stringify(result, null, 2)}`;
}
