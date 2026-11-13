'use strict';
const {NATIVE_FROM_VIEW}=require('../src/protocol.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Measure painted pixels, rather than repeating the SVG dash calculation.
async function quotaGeometryPresentation(win) {
  const zoom=win.webContents.getZoomFactor();
  win.webContents.setZoomFactor(2);
  await win.webContents.executeJavaScript(`(()=>{
    const style=document.createElement('style');style.id='fixture-quota-geometry';
    style.textContent='.cu-ring{position:fixed!important;left:80px!important;top:80px!important}.cu-ring circle{stroke:transparent!important;transition:none!important}.cu-ring .cu-diamond{visibility:hidden}.cu-ring[data-fixture-ring=remaining] .cu-remaining,.cu-ring[data-fixture-ring=time] .cu-time{stroke:#00ff00!important}';
    document.head.append(style);
  })()`);
  const samples=[];
  for(const size of [28,32,40]) for(const kind of ['remaining','time']) for(const fraction of [0,.01,.25,.5,.84,1]) {
    await win.webContents.executeJavaScript(`(()=>{
      const ring=document.querySelector('.cu-ring');ring.dataset.fixtureRing='${kind}';
      ring.querySelector('svg').style.cssText='width:${size}px;height:${size}px';
    })()`);
    const minutes=10080, resetFraction=kind==='time'?fraction:1;
    const resetsAt=Date.now()+resetFraction*minutes*60000-(resetFraction===0?1:0);
    win.webContents.send(NATIVE_FROM_VIEW,{type:'mcp-notification',hostId:'local',method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:kind==='remaining'?(1-fraction)*100:50,windowDurationMins:minutes,resetsAt}}}});
    await delay(80);
    const geometry=await win.webContents.executeJavaScript(`(()=>{
      const circle=document.querySelector('.cu-${kind}'),m=circle.getScreenCTM(),style=getComputedStyle(circle);
      const center=new DOMPoint(circle.cx.baseVal.value,circle.cy.baseVal.value).matrixTransform(m);
      const scale=Math.hypot(m.a,m.b);
      return {x:center.x,y:center.y,radius:circle.r.baseVal.value*scale,
        stroke:parseFloat(style.strokeWidth)*(style.vectorEffect==='non-scaling-stroke'?1:scale),width:innerWidth,height:innerHeight};
    })()`);
    const image=await win.webContents.capturePage(),dimensions=image.getSize(),pixels=image.toBitmap();
    const scale=dimensions.width/geometry.width;
    let painted=0;
    const count=1440;
    for(let index=0;index<count;index++) {
      const angle=index/count*2*Math.PI-Math.PI/2;
      if([-.35,0,.35].some(inset=>{
        const x=Math.round((geometry.x+(geometry.radius+inset)*Math.cos(angle))*scale-.5);
        const y=Math.round((geometry.y+(geometry.radius+inset)*Math.sin(angle))*scale-.5);
        const offset=(y*dimensions.width+x)*4;
        return pixels[offset+1]>150&&pixels[offset]<90&&pixels[offset+2]<90;
      }))painted++;
    }
    const expected=fraction===0?0:Math.min(1,fraction+Math.asin(geometry.stroke/(2*geometry.radius))/Math.PI);
    samples.push({size,kind,fraction,painted:painted/count,expected,error:Math.abs(painted/count-expected)});
  }
  await win.webContents.executeJavaScript(`(()=>{
    document.getElementById('fixture-quota-geometry').remove();
    const ring=document.querySelector('.cu-ring');delete ring.dataset.fixtureRing;
    ring.querySelector('svg').style.cssText='';
  })()`);
  win.webContents.setZoomFactor(zoom);
  return {samples,checks:{
    quotaArcProportions:samples.filter(s=>s.fraction>0).every(s=>s.error<.025),
    quotaEmptyArcs:samples.filter(s=>s.fraction===0).every(s=>s.painted===0)
  }};
}

module.exports={quotaGeometryPresentation};
