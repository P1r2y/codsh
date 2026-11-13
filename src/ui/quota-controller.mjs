import protocol from '../protocol.cjs';
import quotaModel from '../quota-model.cjs';

const { normalizeLimits } = quotaModel;

export class QuotaController {
  constructor(ipc, onChange, now = Date.now) {
    this.ipc = ipc;
    this.onChange = onChange;
    this.now = now;
    this.native = null;
    this.fallback = null;
    this.accountChanged = false;
    this.lastPoll = -Infinity;
    this.inflight = false;
    this.disposed = false;
    this.listener = (_event, message) => this.receive(message);
    ipc.on(protocol.NATIVE_FROM_VIEW, this.listener);
  }
  get limits() { return this.native ?? this.fallback; }
  useFallback(value) {
    if (this.disposed || this.accountChanged || !value) return;
    if (!this.fallback || (value.observedAt ?? 0) >= (this.fallback.observedAt ?? 0)) this.fallback = value;
  }
  receive(message) {
    if (this.disposed || message?.hostId !== 'local') return;
    if (message.type === 'mcp-notification' && message.method === 'account/updated') {
      this.native = null;
      this.fallback = null;
      this.accountChanged = true;
      this.onChange();
      return;
    }
    let raw;
    if (message.type === 'mcp-notification' && message.method === 'account/rateLimits/updated') raw = message.params;
    else if (message.type === 'mcp-response' && !message.message?.error) {
      const result = message.message?.result;
      if (result?.rateLimits || result?.rateLimitsByLimitId || result?.rate_limits || result?.rate_limits_by_limit_id) raw = result;
    }
    const limits = normalizeLimits(raw, this.now());
    if (!limits) return;
    // 原生账户快照优先，重置后的零用量不能被旧会话记录覆盖。
    const changed=JSON.stringify(this.native?.groups)!==JSON.stringify(limits.groups);
    this.native = limits;
    if(changed)this.onChange();
  }
  async refresh(force = false) {
    // Native account notifications are authoritative; do not scan logs behind them.
    if(this.native?.groups.some(group=>group.windows.some(w=>w.resetsAt==null||w.resetsAt>this.now())))return;
    if (this.disposed || this.inflight || !force && this.now()-this.lastPoll < 30000) return;
    this.lastPoll = this.now();
    this.inflight = true;
    try {
      const snapshot = await this.ipc.invoke(protocol.READ_CHANNEL, {threadId:null,quotaOnly:true});
      if (this.disposed) return;
      const before=JSON.stringify(this.limits?.groups);
      this.useFallback(snapshot?.limits);
      if(before!==JSON.stringify(this.limits?.groups))this.onChange();
    } catch (error) {
      if (!this.disposed) console.warn('[CodexUsageUI]', String(error));
    } finally { this.inflight = false; }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ipc.removeListener(protocol.NATIVE_FROM_VIEW, this.listener);
    this.native = null;
    this.fallback = null;
  }
}
