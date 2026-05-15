export class SequenceGenerator {
  private counters = new Map<string, number>();

  next(key: string): number {
    const current = this.counters.get(key) ?? 0;
    const next = current + 1;
    this.counters.set(key, next);
    return next;
  }

  current(key: string): number {
    return this.counters.get(key) ?? 0;
  }
}
