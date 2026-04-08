type CheckinCallback = (phone: string) => void;

interface ScheduledItem {
  phone: string;
  handle: ReturnType<typeof setTimeout>;
  scheduledFor: Date;
}

export class Scheduler {
  private pending = new Map<string, ScheduledItem>();

  /**
   * Schedule a check-in for `phone` at `at`.
   * Cancels any existing check-in for the same phone first.
   */
  schedule(phone: string, at: Date, cb: CheckinCallback): void {
    this.cancel(phone);

    const delay = at.getTime() - Date.now();

    if (delay <= 0) {
      // Already past — fire immediately (async so call stack can settle)
      setImmediate(() => cb(phone));
      return;
    }

    const handle = setTimeout(() => {
      this.pending.delete(phone);
      cb(phone);
    }, delay);

    this.pending.set(phone, { phone, handle, scheduledFor: at });
  }

  cancel(phone: string): void {
    const item = this.pending.get(phone);
    if (item) {
      clearTimeout(item.handle);
      this.pending.delete(phone);
    }
  }

  isScheduled(phone: string): boolean {
    return this.pending.has(phone);
  }

  scheduledFor(phone: string): Date | null {
    return this.pending.get(phone)?.scheduledFor ?? null;
  }

  cancelAll(): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.handle);
    }
    this.pending.clear();
  }
}
