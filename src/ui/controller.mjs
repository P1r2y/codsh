import protocol from '../protocol.cjs';

export class ConversationController {
  constructor(read, onChange) {
    this.read = read;
    this.onChange = onChange;
    this.threadId = null;
    this.snapshot = null;
    this.revision = 0;
    this.inflight = null;
    this.pending = false;
    this.disposed = false;
  }
  select(value) {
    if (this.disposed) return false;
    const id = protocol.normalizeThreadId(value);
    if (id === this.threadId) return false;
    this.threadId = id;
    this.snapshot = null;
    this.revision++;
    this.onChange(true);
    return true;
  }
  async refresh() {
    if (this.disposed) return;
    if (this.inflight) {
      this.pending = true;
      return;
    }
    const id = this.threadId;
    const revision = this.revision;
    const task = Promise.resolve().then(() => this.read(id));
    this.inflight = task;
    try {
      const next = await task;
      if (!this.disposed && revision === this.revision && next?.threadId === id) {
        this.snapshot = next;
        this.onChange(false);
      }
    } catch (error) {
      if (!this.disposed) console.warn('[CodexUsageUI]', String(error));
    } finally {
      this.inflight = null;
      if (this.pending && !this.disposed) {
        this.pending = false;
        void this.refresh();
      }
    }
  }
  dispose() {
    this.disposed = true;
    this.revision++;
    this.pending = false;
    this.snapshot = null;
  }
}
