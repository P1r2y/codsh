'use strict';

// Count only queries issued by the plugin's isolated world, inside generated tool output.
const instrumentation = `(()=>{
  let scans = 0;
  for (const method of ['querySelector','querySelectorAll']) {
    const native = Element.prototype[method];
    Element.prototype[method] = function(selector) {
      if (selector.includes('data-response-annotation-conversation') && this.closest('[data-fixture-output]')) scans++;
      return native.call(this, selector);
    };
  }
  document.addEventListener('read-stream-scans',()=>{
    document.documentElement.dataset.streamScans = String(scans); scans = 0;
  });
})();\n`;

async function longStream(win, snapshots, fixture, enabled) {
  const toolHeavy = process.env.CODEX_USAGE_UI_TEST_TOOL_HISTORY === '1';
  const count = toolHeavy ? 44 : 1200, thread = '00000000-0000-4000-8000-000000000003';
  const liveId = '11111111-0000-4000-8000-000000000004';
  const snapshot = structuredClone(fixture.snapshot);
  const prototype = snapshot.turns[0];
  snapshot.threadId = thread;
  snapshot.revision = 'live';
  snapshot.turns = Array.from({length:count}, (_,i) => ({...prototype,id:'history-'+i,completed:i<count-1}));
  snapshot.turns.at(-1).id = liveId;
  snapshot.turns.at(-1).startedAt = Date.now()-60000;
  snapshot.turnCount = count;
  snapshots.set(thread,snapshot);
  const page = code => win.webContents.executeJavaScript(code);
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  const waitFor = async (code, ms=3000) => {
    const end = Date.now()+ms;
    do { if (await page(code)) return true; await pause(60); } while (Date.now()<end);
    return false;
  };
  await page(`(()=>{
    const main=document.querySelector('main.chat'), template=main.querySelector('[data-content-search-turn-key]').cloneNode(true);
    template.querySelector('.cu-turn')?.remove();
    const scroller=document.createElement('section'); scroller.style.cssText='height:570px;overflow:auto';
    main.before(scroller); scroller.append(main); main.replaceChildren();
    const fragment=document.createDocumentFragment(), rows=[];
    const card=document.createElement('details'), summary=document.createElement('summary'), pre=document.createElement('pre');
    summary.textContent='Tool result';card.append(summary,pre);
    for(let i=0;i<20;i++){const token=document.createElement('span');token.textContent='line ';pre.append(token);}
    for (let i=0;i<${count};i++) {
      const row=template.cloneNode(true); row.dataset.contentSearchTurnKey='history-'+i;
      row.querySelector('.response').dataset.responseAnnotationConversation=${JSON.stringify(thread)};
      if (${toolHeavy}) for(let j=0;j<(i===${count-1}?2:24);j++) row.prepend(card.cloneNode(true));
      rows.push(row); fragment.append(row);
    }
    main.append(fragment);
    const last=rows.at(-1), text=last.querySelector('p'), tool=document.createElement('div');
    last.dataset.contentSearchTurnKey=${JSON.stringify(liveId)};
    if (${toolHeavy}) last.querySelector('.response').removeAttribute('data-response-annotation-conversation');
    tool.dataset.fixtureOutput=''; (${toolHeavy} ? last : last.querySelector('.response')).append(tool);
    const snippet=document.createElement('pre');
    for(let i=0;i<100;i++){const span=document.createElement('span');span.textContent='output ';snippet.append(span);}
    const mountCount=()=>main.querySelectorAll('.cu-turn').length;
    window.streamFixture = {rows,mountCount, seen:i=>!!rows[i].querySelector('.cu-turn'),
      distant:()=>[...main.querySelectorAll('.cu-turn')].filter(node=>Number(node.dataset.cuTurn.slice(8))<${count-24}).length,
      go:i=>rows[i].scrollIntoView({block:'center',behavior:'instant'}),
      tick:i=>{text.textContent='stream '+i; const output=snippet.cloneNode(true); tool.replaceChildren(output);},
      scanCount:()=>{document.dispatchEvent(new Event('read-stream-scans'));return Number(document.documentElement.dataset.streamScans||0);}};
    scroller.scrollTop=scroller.scrollHeight;
    document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',${JSON.stringify(thread)});
  })()`);
  const active = !enabled || await waitFor(`document.querySelector('.cu-strip')?.dataset.cuThread===${JSON.stringify(thread)} && !!document.querySelector('[data-cu-live]')`);
  const firstVisible=!enabled || await waitFor('streamFixture.seen('+ (count-2) +')',4500);
  await pause(350);
  const dbg=win.webContents.debugger; dbg.attach('1.3');
  try {
    await dbg.sendCommand('Performance.enable');
    const metrics = async()=>Object.fromEntries((await dbg.sendCommand('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const before=await metrics();
    const stream=await page(`(async()=>{
      const f=streamFixture; f.scanCount(); const initial=f.mountCount(); let worstTickMs=0,prev=performance.now();
      for(let i=0;i<100;i++){f.tick(i);await new Promise(r=>setTimeout(r,40));const now=performance.now();worstTickMs=Math.max(worstTickMs,now-prev);prev=now;}
      return {initial,after:f.mountCount(),distant:f.distant(),scans:f.scanCount(),worstTickMs};
    })()`);
    const after=await metrics();
    const reading=Math.floor(count/3);
    await page('streamFixture.go('+reading+')');
    const readsOlder=!enabled || await waitFor('streamFixture.seen('+reading+')');
    const withOlder=await page('streamFixture.mountCount()');
    // A nested response and its action bar can arrive in the final streamed update.
    await page(`(()=>{const row=streamFixture.rows.at(-1),answer=row.querySelector('.response');
      const nested=answer.cloneNode(false);nested.dataset.fixtureFinal='';nested.append(row.querySelector('.turn-action-controls').cloneNode(false));
      nested.dataset.responseAnnotationConversation=${JSON.stringify(thread)};
      answer.append(nested); streamFixture.go(${count-1});})()`);
    snapshot.revision='done'; snapshot.turns.at(-1).completed=true;
    const finished=!enabled || await waitFor("streamFixture.rows.at(-1).querySelector('[data-fixture-final] .turn-action-controls .cu-turn')",7500);
    const errors=await page('window.fixtureErrors.length');
    const sample={layoutCount:after.LayoutCount-before.LayoutCount,taskMs:Math.round(1000*(after.TaskDuration-before.TaskDuration))};
    return {count,toolHeavy,enabled,stream,readsOlder,withOlder,finished,sample,checks:{
      active,firstVisible,streamSkipsOutput:stream.scans===0,backgroundQuiet:stream.distant===0,
      limited:stream.after<40&&withOlder<80,readsOlder,finished,noErrors:errors===0
    }};
  } finally {dbg.detach();}
}

module.exports = {instrumentation,longStream};
