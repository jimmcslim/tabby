/** Closing this many tabs (or more) in one go asks for confirmation first. */
export const BULK_CLOSE_CONFIRM_THRESHOLD = 10

/** Whether a bulk close of `count` tabs needs the user to confirm. */
export function bulkCloseNeedsConfirm(count: number): boolean {
  return count >= BULK_CLOSE_CONFIRM_THRESHOLD
}
