import usageModel from '../usage-model.cjs';
import { element, iconSvg } from './elements.mjs';
import { fmt, pct, tokens, completedDate, elapsed, speedLabel } from './format.mjs';

const { statisticsFor, usageParts } = usageModel;

export function createDetailsPopover(onOpen) {
  let snapshot = null;
  let metricPanel = null, panelAnchor = null, panelCloseTimer = null, tokenModel = null;
  let byId = new Map();

  function statRow(label,value) {
    const row=element('div','cu-stat-row');row.append(element('span','cu-stat-label',label),element('span','cu-stat-value',value??'暂无数据'));return row;
  }

  function panelHeader(title,icon,total) {
    const header=element('div','cu-panel-header'),heading=element('strong','cu-panel-heading');
    if(icon)heading.append(iconSvg(icon));heading.append(element('span','',title));header.append(heading);
    if(total)header.append(element('strong','cu-panel-total',total));return header;
  }

  function usageTrack(parts,percent=null) {
    const track=element('div',`cu-context-track${percent===null?' cu-token-track':''}`),fill=element('div','cu-context-fill');
    const total=parts.reduce((sum,p)=>sum+(p.amount??0),0);
    if(percent===null){track.role='img';track.setAttribute('aria-label',parts.map(p=>`${p.label} ${tokens(p.amount)}`).join('，'));}
    else{
      track.role='progressbar';track.setAttribute('aria-label','上下文占用');track.setAttribute('aria-valuenow',String(Math.round(percent)));track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
      track.setAttribute('aria-valuetext',parts.map(p=>`${p.label} ${tokens(p.amount)}`).join('，'));
    }
    fill.style.width=`${percent===null?(total>0?100:0):Math.min(100,Math.max(0,percent))}%`;
    for(const part of parts){
      const segment=element('span',`cu-context-segment cu-context-${part.key}`);
      segment.dataset.cuCategory=part.key;segment.style.width=`${total>0?(part.amount??0)/total*100:0}%`;segment.setAttribute('aria-hidden','true');fill.append(segment);
    }
    track.append(fill);return track;
  }

  function usageRow(part) {
    const row=statRow(part.label,part.amount==null?'—':tokens(part.amount));row.dataset.cuCategory=part.key;row.classList.add(`cu-context-${part.key}`);
    const dot=element('span','cu-context-dot');dot.setAttribute('aria-hidden','true');row.firstElementChild.prepend(dot);return row;
  }

  function selectTokenModel(model) {
    tokenModel=model;renderMetricPanel();
    [...metricPanel.querySelectorAll('.cu-model-view')].find(button=>button.getAttribute('aria-pressed')==='true')?.focus({preventScroll:true});
  }

  function tokenDetails(scope,turn) {
    const models=scope.models??[{model:null,usage:scope.usage??scope.total}],key=model=>model.model??'';
    if(tokenModel!==null&&!models.some(model=>key(model)===tokenModel))tokenModel=null;
    const selected=tokenModel===null?scope:models.find(model=>key(model)===tokenModel),u=selected.usage??selected.total;
    const body=element('div','cu-token-details'),views=element('div','cu-model-views');views.role='group';views.setAttribute('aria-label','模型');
    for(const view of [{key:null,label:'总览'},...models.map(model=>({key:key(model),label:model.model??'未知模型'}))]){
      const button=element('button','cu-model-view',view.label);button.type='button';button.dataset.cuModel=view.key??'*';
      button.setAttribute('aria-pressed',String(tokenModel===view.key));button.addEventListener('click',()=>selectTokenModel(view.key));views.append(button);
    }
    const parts=usageParts(u,true);
    body.append(panelHeader(turn?'本轮用量':'Token 用量','token',tokens(u?.total_tokens)),views,usageTrack(parts),...parts.map(usageRow),
      statRow('缓存命中',pct(selected.cacheHitPercent)));
    if(tokenModel===null&&models.length>1){
      const list=element('div','cu-model-list');
      for(const model of models){
        const button=element('button','cu-model-summary');button.type='button';button.dataset.cuModel=key(model);
        button.append(element('span','',model.model??'未知模型'),element('span','',tokens(model.usage?.total_tokens)));
        button.addEventListener('click',()=>selectTokenModel(key(model)));list.append(button);
      }
      body.append(list);
    }
    return body;
  }

  function buildMetricDetails(anchor) {
    const kind=anchor.dataset.cuKind,id=anchor.dataset.cuTurn;
    const turn=id?byId.get(id):null,last=snapshot?.turns?.at(-1);
    const nodes=[];
    if(!snapshot?.available)return [element('p','cu-note','暂无可用统计数据')];
    if(kind==='tokens'){
      nodes.push(tokenDetails(turn??snapshot,turn));
    }else if(kind==='context'){
      const usage=snapshot.lastUsage;
      // 缓存属于输入的一部分，三种颜色按互不重叠的计数绘制。
      const parts=usageParts(usage);
      nodes.push(panelHeader(`上下文已用 ${pct(snapshot.contextPercent)}`,'context',`${fmt(usage?.total_tokens)} / ${fmt(snapshot.contextWindow)}`));
      if(snapshot.contextPercent!=null)nodes.push(usageTrack(parts,snapshot.contextPercent));
      nodes.push(...parts.map(usageRow));
      nodes.push(statRow('模型窗口',tokens(snapshot.contextWindow)));
    }else{
      const active=kind==='live'?last:turn,turns=active?[active]:snapshot.turns??[];
      const statistics=statisticsFor(turns),generated=statistics.generatedMs,duration=statistics.durationMs;
      const firstTokens=turns.map(t=>t.timeToFirstTokenMs).filter(n=>n!=null);
      const generation=statistics.estimatedGenerationTps!=null;
      nodes.push(panelHeader(kind==='live'?'当前执行':turn?'本轮统计':'会话统计','speed'),
        statRow(active?'状态':'对话轮数',active?active.status:`${snapshot.turnCount} 轮`),
        statRow('模型请求',`${turns.reduce((n,t)=>n+t.requests,0)} 次`),
        statRow('模型生成区间',generated!=null?elapsed(generated):'暂无完整计时'),statRow('整轮耗时',duration!=null?elapsed(duration):null),
        statRow('工具调用',`${turns.reduce((n,t)=>n+t.tools,0)} 次`),
        statRow(active?'首 token 等待（TTFT）':'每轮首 token 平均',firstTokens.length?elapsed(firstTokens.reduce((a,b)=>a+b,0)/firstTokens.length):null),
        statRow(kind==='live'?'当前整轮平均':generation?'生成速度（估算）':'整轮平均速度',kind==='live'?`${statistics.averageTps?.toFixed(1)??'—'} tok/s`:speedLabel(statistics).replace(/^整轮 /,'')));
    }
    if(completedDate(turn))nodes.push(statRow(turn?.endInferred?'最后记录时间':'完成时间',completedDate(turn)));
    return nodes;
  }

  function renderMetricPanel() {
    if(!metricPanel || metricPanel.hidden || !panelAnchor)return;
    if(!panelAnchor.isConnected){closeMetricPanel();return;}
    const nodes=buildMetricDetails(panelAnchor),signature=JSON.stringify([panelAnchor.dataset.cuKind,panelAnchor.dataset.cuTurn,tokenModel,...nodes.map(n=>n.textContent)]);
    if(metricPanel.dataset.content!==signature){
      const focused=metricPanel.contains(document.activeElement)?document.activeElement.dataset.cuModel:undefined;
      const previous=metricPanel.querySelector('.cu-token-track'),next=nodes[0]?.querySelector('.cu-token-track');
      if(previous&&next){
        previous.setAttribute('aria-label',next.getAttribute('aria-label'));
        previous.firstElementChild.style.width=next.firstElementChild.style.width;
        const fill=previous.firstElementChild,segments=[...fill.children],keys=new Set();
        for(const segment of [...next.firstElementChild.children]){
          const key=segment.dataset.cuCategory,existing=segments.find(e=>e.dataset.cuCategory===key);
          keys.add(key);if(existing){existing.style.width=segment.style.width;fill.append(existing);}else fill.append(segment);
        }
        for(const segment of segments)if(!keys.has(segment.dataset.cuCategory))segment.remove();
        next.replaceWith(previous);
      }
      metricPanel.replaceChildren(...nodes);metricPanel.dataset.content=signature;
      if(focused!==undefined)[...metricPanel.querySelectorAll('.cu-model-view')].find(button=>button.dataset.cuModel===focused)?.focus({preventScroll:true});
    }
    positionMetricPanel();
  }

  function toggleMetricPanel(anchor) {
    if(panelAnchor===anchor && metricPanel?.dataset.state==='open'){closeMetricPanel();return;}
    panelAnchor?.setAttribute('aria-expanded','false');panelAnchor=anchor;anchor.setAttribute('aria-expanded','true');
    tokenModel=null;
    clearTimeout(panelCloseTimer);
    if(!metricPanel){metricPanel=element('div','cu-panel');metricPanel.id='cu-metric-popover';metricPanel.role='dialog';metricPanel.tabIndex=-1;document.body.append(metricPanel);}
    metricPanel.setAttribute('aria-label',anchor.dataset.cuKind==='context'?'上下文详情':anchor.dataset.cuKind==='tokens'?'Token 用量详情':'速度统计详情');
    metricPanel.classList.toggle('cu-token-panel',anchor.dataset.cuKind==='tokens');
    metricPanel.dataset.state='closed';metricPanel.hidden=false;renderMetricPanel();
    metricPanel.dataset.state='open';
    onOpen();
  }

  function closeMetricPanel(returnFocus=false) {
    const previous=panelAnchor;previous?.setAttribute('aria-expanded','false');panelAnchor=null;
    clearTimeout(panelCloseTimer);
    if(metricPanel){metricPanel.dataset.state='closed';panelCloseTimer=setTimeout(()=>{if(metricPanel)metricPanel.hidden=true;},160);}
    if(returnFocus && previous?.isConnected)previous.focus({preventScroll:true});
  }

  function positionMetricPanel() {
    if(!metricPanel || metricPanel.hidden || !panelAnchor?.isConnected)return;
    const a=panelAnchor.getBoundingClientRect(),p={width:metricPanel.offsetWidth,height:metricPanel.offsetHeight};
    if(a.bottom<0 || a.top>innerHeight){closeMetricPanel();return;}
    const above=a.top-p.height-10,below=a.bottom+10;
    const top=above>=12?above:below+p.height<=innerHeight-12?below:Math.max(12,Math.min(above,innerHeight-p.height-12));
    metricPanel.style.left=`${Math.max(12,Math.min(a.left,innerWidth-p.width-12))}px`;
    metricPanel.style.top=`${top}px`;
    metricPanel.style.transformOrigin=top<a.top?'bottom left':'top left';
  }
  return {
    toggle: toggleMetricPanel,
    close: closeMetricPanel,
    position: positionMetricPanel,
    update(value) { snapshot = value; byId = new Map((value?.turns ?? []).map(turn => [turn.id, turn])); renderMetricPanel(); },
    remove(node) { if (node === panelAnchor || node.contains(panelAnchor)) closeMetricPanel(); },
    outside(event) { if (panelAnchor && !panelAnchor.contains(event.target) && !metricPanel?.contains(event.target)) closeMetricPanel(); },
    keydown(event) {
      if (event.key === 'Escape' && panelAnchor) { event.preventDefault(); event.stopPropagation(); closeMetricPanel(true); }
    },
    dispose() {
      clearTimeout(panelCloseTimer);
      panelAnchor?.setAttribute('aria-expanded', 'false');
      metricPanel?.remove();
      panelAnchor = null; metricPanel = null; snapshot = null; byId.clear();
    }
  };
}
