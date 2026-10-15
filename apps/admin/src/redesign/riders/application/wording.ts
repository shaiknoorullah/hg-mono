const ORDINALS = ['1st', '2nd', '3rd'];

/** "1st", "2nd", "3rd", "4th": the rider's attempt number as the server counts it (no cap). */
export function attemptWord(n: number | undefined | null): string {
  const attempt = Math.max(1, n ?? 1);
  return ORDINALS[attempt - 1] ?? `${attempt}th`;
}
