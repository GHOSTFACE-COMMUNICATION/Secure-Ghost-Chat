// PHANTOM seam — a future dead-man's-switch feature will subscribe to these
// to track failed-unlock attempts and lock timestamps. No subscribers exist
// yet; emitting is a no-op until something calls onFailedUnlock/onLockTimestamp.

type FailedUnlockReason = "pin" | "biometric";
type FailedUnlockListener = (reason: FailedUnlockReason, at: number) => void;
type LockTimestampListener = (at: number) => void;

const failedUnlockListeners = new Set<FailedUnlockListener>();
const lockTimestampListeners = new Set<LockTimestampListener>();

export function onFailedUnlock(listener: FailedUnlockListener): () => void {
  failedUnlockListeners.add(listener);
  return () => failedUnlockListeners.delete(listener);
}

export function emitFailedUnlock(reason: FailedUnlockReason): void {
  const at = Date.now();
  failedUnlockListeners.forEach((listener) => listener(reason, at));
}

export function onLockTimestamp(listener: LockTimestampListener): () => void {
  lockTimestampListeners.add(listener);
  return () => lockTimestampListeners.delete(listener);
}

export function emitLockTimestamp(): void {
  const at = Date.now();
  lockTimestampListeners.forEach((listener) => listener(at));
}
