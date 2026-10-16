// Small per-browser preferences; the page works without storage.

export function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`lm.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function store(key: string, value: unknown) {
  try {
    localStorage.setItem(`lm.${key}`, JSON.stringify(value));
  } catch {
    // private window or blocked storage: the preference is just not kept
  }
}
