/** Waits `ms` milliseconds — for a rule's `delay` option. No-op for 0/undefined. */
export function delay(ms: number | undefined): Promise<void> {
  return ms ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}
