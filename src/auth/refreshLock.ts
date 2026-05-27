let _pending: Promise<unknown> | null = null;

export async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (_pending) return _pending as Promise<T>;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('refresh_timeout')), 10_000)
  );
  _pending = Promise.race([fn(), timeout]).finally(() => { _pending = null; });
  return _pending as Promise<T>;
}
