import { Lifetime } from './lifetime.mjs';
import { BackgroundScan } from './background-scan.mjs';
import { ReplyCache } from './reply-cache.mjs';
import { ConversationController } from './controller.mjs';
import { QuotaController } from './quota-controller.mjs';
import { CodexDOM } from './dom.mjs';
import { MetricGroup, invalidateMetricLayout } from './metrics.mjs';
import { createDetailsPopover } from './details.mjs';
import { createQuotaWidget } from './quota.mjs';
import { element } from './elements.mjs';
import { fmt, pct, speedLabel, sessionSpeedReader } from './format.mjs';
import protocol from '../protocol.cjs';
import styles from './styles.css';

export class UsagePlugin {
  constructor(ipc) {
    this.life = new Lifetime();
    this.dom = new CodexDOM();
    this.replies = new Map();
    this.replyCache = new ReplyCache(thread => {
      if (this.replyThread === thread && document.visibilityState !== 'hidden')
        this.replyScan.request(() => this.renderReplies(thread), true);
    });
    this.sessionSpeeds = new WeakMap();
    this.replyScan = new BackgroundScan();
    this.readTimer = null;
    this.renderTimer = null;
    this.lastSync = 0;
    this.details = createDetailsPopover(() => this.quota.hide());
    this.quota = createQuotaWidget(() => { this.details.close(); void this.quotaState.refresh(true); });
    this.quotaState = new QuotaController(ipc, () => this.renderQuota());
    const changed=(_event,message)=>{
      if(message?.threadId!==this.controller.threadId)return;
      if(this.controller.snapshot)this.controller.snapshot.eventDriven=message.watching!==false;
      if(document.visibilityState!=='hidden')this.refreshData();
    };
    ipc.on(protocol.CHANGE_CHANNEL,changed);
    this.life.own(()=>ipc.removeListener(protocol.CHANGE_CHANNEL,changed));
    this.controller = new ConversationController(
      (id, knownRevision) => ipc.invoke(protocol.READ_CHANNEL, {threadId:id, knownRevision}),
      (changed, liveOnly) => {
        if (changed) { this.details.close(); return; }
        if (liveOnly) this.renderLive(); else this.renderUsage();
      }
    );
    const strip = element('div', 'cu-strip');
    strip.setAttribute('aria-label', '当前对话用量统计');
    strip.setAttribute('data-markdown-copy', 'exclude');
    this.strip = this.group(strip, true);
    this.style = element('style');
    this.style.id = 'codex-usage-ui-style';
    this.style.textContent = styles;
  }
  group(node, animated = false) {
    return new MetricGroup(node, button => this.details.toggle(button), node => this.details.remove(node), animated);
  }
  refreshData(immediate = false) {
    if(this.life.disposed||document.visibilityState==='hidden'||!this.controller.threadId)return;
    if(immediate){clearTimeout(this.readTimer);this.readTimer=null;}
    if(this.readTimer!==null)return;
    const delay=immediate?0:Math.max(0,5000-(Date.now()-this.lastSync));
    this.readTimer=setTimeout(()=>{
      this.readTimer=null;
      if(this.life.disposed||document.visibilityState==='hidden')return;
      this.lastSync=Date.now();void this.controller.refresh();
    },delay);
  }
  synchronize(context = this.dom.context(), immediate = false) {
    if (this.life.disposed) return;
    const switched=this.controller.select(context.id);
    if(switched){
      this.replyScan.cancel();clearTimeout(this.readTimer);this.readTimer=null;
      this.leaveReplies();
    }
    this.render(context);
    if(document.visibilityState==='hidden')return;
    this.refreshData(switched||immediate);
    void this.quotaState.refresh();
  }
  renderStrip(snapshot, id) {
    if (!snapshot?.available) {
      this.details.remove(this.strip.node);
      this.strip.message(id ? '用量统计 · 等待本地会话数据' : '用量统计 · 开始对话后显示');
      return;
    }
    const last = snapshot.turns?.at(-1);
    let speed = this.sessionSpeeds.get(snapshot);
    if (!speed) {
      speed = sessionSpeedReader(snapshot.turns ?? []);
      this.sessionSpeeds.set(snapshot, speed);
    }
    const items = [
      {key:'session',icon:'speed',kind:'session',text:`${snapshot.turnCount} 轮 ${snapshot.requests} 步 · ${speed()}`},
      {key:'tokens',icon:'token',kind:'tokens',text:`${fmt(snapshot.total.total_tokens)} tok · 缓存命中 ${pct(snapshot.cacheHitPercent)}`},
      {key:'context',icon:'context',kind:'context',text:pct(snapshot.contextPercent)}
    ];
    if (last && !last.completed) items.push({key:'live',icon:'speed',kind:'live',text:`当前 ${last.averageTps?.toFixed(1) ?? '—'} tok/s`,live:true});
    this.strip.render(items);
  }
  renderLive() {
    const snapshot = this.controller.snapshot;
    if (!snapshot || !this.strip.node.isConnected) return;
    this.renderStrip(snapshot, this.controller.threadId);
    this.details.update(snapshot);
  }
  renderQuota(mount) {
    if(this.life.disposed||document.visibilityState==='hidden')return;
    this.lastQuotaPaint=Date.now();
    this.quota.render({limits:this.quotaState.limits}, mount === undefined ? this.dom.quotaMount() : mount);
  }
  render(context = this.dom.context()) {
    if (this.life.disposed || !document.body) return;
    if (context.id !== this.controller.threadId) { this.synchronize(context); return; }
    // Discover the native mount before changing labels can invalidate layout.
    const mount = this.dom.quotaMount();
    if (context.composer && !this.dom.chatMode(context.composer)) {
      this.dom.alignComposer(context.composer);
      this.strip.mount(context.composer);
      const id = context.id ?? '';
      if (this.strip.node.dataset.cuThread !== id) this.strip.node.dataset.cuThread = id;
    } else this.strip.unmount();
    this.renderUsage(mount);
    this.dom.reconcile();
  }
  renderUsage(mount) {
    if (this.life.disposed || document.visibilityState === 'hidden') return;
    const {snapshot, threadId} = this.controller;
    if (this.strip.node.isConnected) this.renderStrip(snapshot, threadId);
    if (snapshot?.available) {
      const thread = this.replyCache.select(threadId, snapshot);
      if (this.replyThread !== thread) {
        this.replyThread = thread;
        this.replies = thread.groups;
        thread.restore();
      }
      if (!thread.indexed || thread.dirty.size) this.replyScan.request(() => this.renderReplies(thread));
    } else {
      this.replyScan.cancel();
      this.leaveReplies();
    }
    const limits = this.quotaState.limits;
    this.quotaState.useFallback(snapshot?.limits);
    if (mount !== undefined || this.quotaState.limits !== limits) this.renderQuota(mount);
    this.details.update(snapshot);
  }
  leaveReplies() {
    if (!this.replyThread) return;
    for (const group of this.replies.values()) {
      this.dom.setActionParent(group.node, null);
      group.unmount();
    }
    this.replyThread = null;
    this.replies = new Map();
  }
  renderReply(threadId, id, mount, turn) {
    let group = this.replies.get(id);
    if (!group) {
      const node = element('div', 'cu-turn');
      node.setAttribute('data-markdown-copy', 'exclude');
      node.dataset.cuThread = threadId;
      node.dataset.cuTurn = id;
      group = this.group(node);
      this.replies.set(id, group);
    }
    group.node.classList.toggle('cu-turn-inline', mount.inline);
    this.dom.setActionParent(group.node, mount.inline ? mount.parent : null);
    group.mount(mount.parent);
    group.render([
      {key:'tokens',icon:'token',kind:'tokens',turnId:id,text:`用量 ${fmt(turn.usage.total_tokens)} tok`},
      {key:'cache',kind:'tokens',turnId:id,text:`缓存 ${pct(turn.cacheHitPercent)}`},
      {key:'speed',kind:'session',turnId:id,text:speedLabel(turn)}
    ]);
  }
  *renderReplies(thread) {
    for (const change of thread.changes()) {
      if (this.life.disposed || document.visibilityState === 'hidden' || this.replyThread !== thread) return;
      if (!change) { yield; continue; }
      const {key, turn, mount} = change;
      yield deferred => {
        if (this.replyThread !== thread || thread.dirty.has(key)) return;
        if (mount) {
          if ((!thread.viewport || thread.nearby.has(mount.response)) &&
            mount.parent.isConnected && (!deferred || mount.stillCurrent()))
            this.renderReply(thread.id, key, mount, turn);
        } else {
          const group = thread.groups.get(key);
          if (group) {
            this.dom.setActionParent(group.node, null);
            // A retained pane may already be hidden while its navigation event is pending.
            if (turn?.completed && thread.byTurn.has(key)) group.unmount();
            else {
              group.dispose();
              thread.groups.delete(key);
            }
          }
        }
      };
    }
    return () => this.dom.reconcile();
  }
  align() {
    invalidateMetricLayout();
    const composer = this.dom.composer();
    this.dom.cachedQuotaMount = undefined;
    this.renderQuota();
    if (!this.dom.chatMode(composer)) this.dom.alignComposer(composer, true);
    this.strip.align();
    if (this.replyThread) {
      const thread = this.replyThread;
      thread.restore();
      this.replyScan.request(() => this.renderReplies(thread));
    }
    this.details.position();
    this.quota.position();
  }
  start() {
    if (this.life.disposed || this.started) return;
    this.started = true;
    document.head.append(this.style);
    document.documentElement.dataset.cuUi = 'ready';
    const reconcile = (delay = 200) => {
      const deadline = performance.now() + delay;
      if (this.renderTimer !== null) {
        if (this.renderDeadline <= deadline) return;
        clearTimeout(this.renderTimer);
      }
      this.renderDeadline = deadline;
      this.renderTimer = setTimeout(() => {
        this.renderTimer = null;
        if (document.visibilityState==='hidden') return;
        const context=this.dom.context();
        if (context.id !== this.controller.threadId) this.synchronize(context);
        else {
          this.render(context);
        }
      }, delay);
    };
    this.dom.watchVisibility(scopes => {
      this.dom.fallbackThread = null;
      for (const scope of scopes) this.replyCache.visibility(scope);
      reconcile(0);
    });
    this.dom.watchQuota(() => reconcile(80));
    const observer = new MutationObserver(batch => {
      const records = batch.filter(record => this.replyCache.relevantDuringStream(record, this.replyThread));
      if (!records.length) return;
      const revision = this.replyThread?.domRevision;
      this.replyCache.observe(records, this.replyThread, this.dom);
      if (document.visibilityState === 'hidden') return;
      let needsRender = false;
      for (const record of records) {
        if (this.dom.remountActions(record, this.controller.threadId, this.replies)) continue;
        needsRender ||= this.dom.relevant(record);
      }
      if (needsRender || this.replyThread?.domRevision !== revision) {
        const navigating = records.some(record => record.attributeName === 'data-above-composer-conversation-id' ||
          record.type === 'attributes' && this.dom.visibilityNodes.has(record.target));
        reconcile(navigating ? 0 : records.some(record => record.type === 'attributes') ? 80 : 200);
      }
    });
    observer.observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:[
      'data-above-composer-conversation-id','data-content-search-turn-key',
      'data-response-annotation-conversation','data-chatgpt-composer','data-thread-find-composer',
      'data-app-navigation-rail','aria-hidden','hidden','inert'
    ]});
    this.life.own(() => observer.disconnect());
    this.life.listen(window, 'resize', () => this.align());
    this.life.listen(window, 'focus', () => this.synchronize());
    this.life.listen(document,'visibilitychange',()=>{
      if(document.visibilityState!=='hidden'){this.replyThread?.restore();this.synchronize(this.dom.context(),true);}
      else{this.replyScan.cancel();clearTimeout(this.readTimer);this.readTimer=null;}
    });
    this.life.listen(window, 'popstate', () => this.synchronize());
    this.life.listen(window, 'hashchange', () => this.synchronize());
    this.life.listen(document, 'pointerdown', event => { this.details.outside(event); this.quota.outside(event); }, {capture:true});
    this.life.listen(document, 'keydown', event => { this.details.keydown(event); this.quota.keydown(event); }, {capture:true});
    this.life.listen(document, 'scroll', () => this.details.position(), {capture:true});
    this.life.interval(() => {
      if(document.visibilityState==='hidden')return;
      const turns = this.controller.snapshot?.turns ?? [];
      const live = Boolean(turns.at(-1) && !turns.at(-1).completed);
      const snapshot=this.controller.snapshot;
      const interval=snapshot?.eventDriven?60000:!snapshot?.available||live?5000:30000;
      if(Date.now()-this.lastSync>=interval)this.refreshData();
      // Only the active clock changes between log notifications.
      else if(live&&snapshot?.eventDriven){
        const turn=turns.at(-1),duration=turn.startedAt==null?null:Math.max(0,Date.now()-turn.startedAt);
        if(duration!=null){turn.durationMs=duration;turn.averageTps=duration>0?turn.usage.output_tokens*1000/duration:null;this.renderLive();}
      }
      if(Date.now()-(this.lastQuotaPaint??0)>=60000)this.renderQuota();
    }, 2500);
    this.life.listen(window, 'beforeunload', () => this.dispose(), {once:true});
    document.fonts?.ready.then(() => { if (!this.life.disposed) this.align(); });
    this.synchronize();
  }
  dispose() {
    if (this.life.disposed) return;
    this.life.dispose();
    clearTimeout(this.renderTimer);
    clearTimeout(this.readTimer);
    this.replyScan.dispose();
    this.controller.dispose();
    this.quotaState.dispose();
    this.strip.dispose();
    this.replyCache.dispose();
    this.details.dispose();
    this.quota.dispose();
    this.dom.dispose();
    this.style.remove();
    delete document.documentElement.dataset.cuUi;
  }
}
