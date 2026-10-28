interface Entry<T> {
  promise: Promise<T>;
  resolved?: { tab: T };
}

export class TabPool<T> {
  private entries = new Map<string, Entry<T>>();
  // Explicit fields keep this constructor compatible with Node's type stripping.
  private create: (key: string) => Promise<T>;
  private alive: (tab: T) => boolean;
  private focus: (tab: T) => void;

  constructor(create: (key: string) => Promise<T>, alive: (tab: T) => boolean, focus: (tab: T) => void) {
    this.create = create;
    this.alive = alive;
    this.focus = focus;
  }

  open(key: string): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      if (!cached.resolved) return cached.promise;
      if (this.alive(cached.resolved.tab)) {
        this.focus(cached.resolved.tab);
        return cached.promise;
      }
      this.entries.delete(key);
    }

    // Defer create until the entry is cached, including synchronous rejection.
    const entry: Entry<T> = {
      promise: Promise.resolve().then(() => this.create(key)),
    };
    entry.promise = entry.promise.then(tab => {
      if (this.entries.get(key) === entry) entry.resolved = { tab };
      return tab;
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return entry.promise;
  }

  forget(key: string, tab: T): void {
    const entry = this.entries.get(key);
    if (entry?.resolved && entry.resolved.tab === tab) this.entries.delete(key);
  }

  clear(): void {
    // Pending callers still settle; their stale entries cannot reenter the cache.
    this.entries.clear();
  }
}
