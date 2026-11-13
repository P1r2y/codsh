import protocol from '../protocol.cjs';

export class ConversationController {
  constructor(read, onChange) {
    this.read = read;
    this.onChange = onChange;
    this.threadId = null;
    this.snapshot = null;
    this.revision = 0;
    this.inflight = new Map();
    this.history = new Map();
    this.pending = false;
    this.disposed = false;
  }
  select(value) {
    if (this.disposed) return false;
    const id = protocol.normalizeThreadId(value);
    if (id === this.threadId) return false;
    this.threadId = id;
    this.snapshot = this.history.get(id) ?? null;
    this.revision++;
    this.onChange(true);
    return true;
  }
  async refresh() {
    if (this.disposed || !this.threadId) return;
    if (this.inflight.has(this.threadId) || this.inflight.size >= 2) {
      this.pending = true;
      return;
    }
    const id = this.threadId;
    const revision = this.revision;
    const knownRevision = this.snapshot?.revision;
    const task = Promise.resolve().then(() => this.read(id, knownRevision));
    this.inflight.set(id, task);
    try {
      const next = await task;
      if (!this.disposed && revision === this.revision && next?.threadId === id) {
        if(this.snapshot&&typeof next.eventDriven==='boolean')this.snapshot.eventDriven=next.eventDriven;
        if (next.unchanged && next.liveTick && this.snapshot) {
          const turn = this.snapshot.turns?.find(item => item.id === next.liveTick.id);
          if (turn && !turn.completed) {
            turn.durationMs = next.liveTick.durationMs;
            turn.averageTps = next.liveTick.averageTps;
            this.onChange(false, true);
          }
        } else if (!next.unchanged) {
          const sameRevision = next.revision && next.revision === this.snapshot?.revision;
          const live = next.turns?.some(turn => !turn.completed);
          this.snapshot = next;
          this.history.delete(id);
          this.history.set(id, next);
          while(this.history.size > 6)this.history.delete(this.history.keys().next().value);
          if (!sameRevision || live) this.onChange(false);
        }
      }
    } catch (error) {
      if (!this.disposed) console.warn('[CodexUsageUI]', String(error));
    } finally {
      this.inflight.delete(id);
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
    this.history.clear();
  }
}
