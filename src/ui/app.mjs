import { Lifetime } from './lifetime.mjs';
import { BackgroundScan } from './background-scan.mjs';
import { ConversationController } from './controller.mjs';
import { QuotaController } from './quota-controller.mjs';
import { CodexDOM } from './dom.mjs';
import { MetricGroup } from './metrics.mjs';
import { createDetailsPopover } from './details.mjs';
import { createQuotaWidget } from './quota.mjs';
import { element } from './elements.mjs';
import { fmt, pct, speedLabel } from './format.mjs';
import usageModel from '../usage-model.cjs';
import protocol from '../protocol.cjs';
import styles from './styles.css';

export class UsagePlugin {
  constructor(ipc) {
    this.life = new Lifetime();
    this.dom = new CodexDOM();
    this.replies = new Map();
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
        if (liveOnly) this.renderLive(); else this.render();
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
      for(const group of this.replies.values())group.dispose();this.replies.clear();
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
    const items = [
      {key:'session',icon:'speed',kind:'session',text:`${snapshot.turnCount} 轮 ${snapshot.requests} 步 · ${speedLabel(usageModel.statisticsFor(snapshot.turns ?? []))}`},
      {key:'tokens',icon:'token',kind:'tokens',text:`${fmt(snapshot.total.total_tokens)} tok · 缓存命中 ${pct(snapshot.cacheHitPercent)}`},
      {key:'context',icon:'context',kind:'context',text:pct(snapshot.contextPercent)}
    ];
    const last = snapshot.turns?.at(-1);
    if (last && !last.completed) items.push({key:'live',icon:'speed',kind:'live',text:`当前 ${last.averageTps?.toFixed(1) ?? '—'} tok/s`,live:true});
    this.strip.render(items);
  }
  renderLive() {
    const snapshot = this.controller.snapshot;
    if (!snapshot || !this.strip.node.isConnected) return;
    this.renderStrip(snapshot, this.controller.threadId);
    this.details.update(snapshot);
  }
  renderQuota() {
    if(this.life.disposed||document.visibilityState==='hidden')return;
    const mount=this.quotaMount;
    if(!mount?.parent?.isConnected||mount.before&&mount.before.parentNode!==mount.parent)this.quotaMount=this.dom.quotaMount();
    this.lastQuotaPaint=Date.now();
    this.quota.render({limits:this.quotaState.limits},this.quotaMount);
  }
  render(context = this.dom.context()) {
    if (this.life.disposed || !document.body) return;
    const snapshot = this.controller.snapshot;
    if (context.id !== this.controller.threadId) { this.synchronize(context); return; }
    if (context.composer && !this.dom.chatMode(context.composer)) {
      this.dom.alignComposer(context.composer);
      this.strip.mount(context.composer);
      this.strip.node.dataset.cuThread = context.id ?? '';
      this.renderStrip(snapshot, context.id);
    } else this.strip.unmount();
    if(snapshot?.available)this.replyScan.request(()=>this.renderReplies());
    else{
      this.replyScan.cancel();
      for(const group of this.replies.values())group.dispose();this.replies.clear();
    }
    this.quotaState.useFallback(snapshot?.limits);
    this.quotaMount=this.dom.quotaMount();
    this.renderQuota();
    this.details.update(snapshot);
    this.dom.reconcile();
  }
  *renderReplies() {
    const threadId=this.controller.threadId,snapshot=this.controller.snapshot,keep=new Set(),realign=this.realignReplies;
    this.realignReplies=false;
    if(!snapshot?.available)return;
    for (const entry of this.dom.scanReplies(snapshot,threadId)) {
      if(this.life.disposed||document.visibilityState==='hidden'||this.controller.threadId!==threadId)return;
      if(!entry){yield;continue;}
      const [id,mount]=entry;
      if(!mount.parent.isConnected){yield;continue;}
      keep.add(id);
      let group = this.replies.get(id);
      if (!group) {
        const node = element('div', 'cu-turn');
        node.setAttribute('data-markdown-copy', 'exclude');
        group = this.group(node);
        this.replies.set(id, group);
      }
      group.node.dataset.cuThread = threadId;
      group.node.dataset.cuTurn = id;
      group.node.classList.toggle('cu-turn-inline', mount.inline);
      if (mount.inline) this.dom.markActions(mount.parent);
      group.mount(mount.parent);
      const turn = mount.turn;
      group.render([
        {key:'tokens',icon:'token',kind:'tokens',turnId:id,text:`用量 ${fmt(turn.usage.total_tokens)} tok`},
        {key:'cache',kind:'tokens',turnId:id,text:`缓存 ${pct(turn.cacheHitPercent)}`},
        {key:'speed',kind:'session',turnId:id,text:speedLabel(turn)}
      ]);
      if(realign)group.align();
      yield;
    }
    for (const [id, group] of this.replies) if (!keep.has(id)) { group.dispose(); this.replies.delete(id); }
    this.dom.reconcile();
  }
  align() {
    const composer = this.dom.composer();
    if (!this.dom.chatMode(composer)) this.dom.alignComposer(composer, true);
    this.strip.align();
    this.realignReplies=true;
    this.replyScan.request(()=>this.renderReplies());
    this.details.position();
    this.quota.position();
  }
  start() {
    if (this.life.disposed || this.started) return;
    this.started = true;
    document.head.append(this.style);
    document.documentElement.dataset.cuUi = 'ready';
    const reconcile = (urgent = false) => {
      if (this.renderTimer) return;
      this.renderTimer = setTimeout(() => {
        this.renderTimer = null;
        if (document.visibilityState==='hidden') return;
        const context=this.dom.context();
        if (context.id !== this.controller.threadId) this.synchronize(context);
        else {
          this.render(context);
        }
      }, urgent ? 80 : 200);
    };
    this.dom.watchVisibility(()=>reconcile(true));
    const observer = new MutationObserver(records => {
      if(this.dom.relevant(records))reconcile(records.some(record=>record.type==='attributes'));
    });
    observer.observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:[
      'data-above-composer-conversation-id','data-content-search-turn-key',
      'data-response-annotation-conversation','data-chatgpt-composer','aria-hidden','hidden','inert'
    ]});
    this.life.own(() => observer.disconnect());
    this.life.listen(window, 'resize', () => this.align());
    this.life.listen(window, 'focus', () => this.synchronize());
    this.life.listen(document,'visibilitychange',()=>{
      if(document.visibilityState!=='hidden')this.synchronize(this.dom.context(),true);
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
    for (const group of this.replies.values()) group.dispose();
    this.replies.clear();
    this.details.dispose();
    this.quota.dispose();
    this.dom.dispose();
    this.style.remove();
    delete document.documentElement.dataset.cuUi;
  }
}
