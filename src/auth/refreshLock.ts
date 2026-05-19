let _pending: Promise<unknown> | null = null;

export async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (_pending) return _pending as Promise<T>;
  _pending = fn().finally(() => { _pending = null; });
  return _pending as Promise<T>;
}
