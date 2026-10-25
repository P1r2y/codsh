import { element, setText, iconSvg } from './elements.mjs';

const textMeasure = document.createElement('canvas').getContext('2d', {willReadFrequently:true});

function metric(icon, text, kind, turnId, onActivate) {
  const el = element('button','cu-metric');el.type='button';
  el.dataset.cuKind=kind;el.dataset.cuTurn=turnId??'';
  el.setAttribute('aria-haspopup','dialog');el.setAttribute('aria-expanded','false');el.setAttribute('aria-controls','cu-metric-popover');
  el.addEventListener('click',()=>onActivate(el));
  if (icon) el.append(iconSvg(icon));
  el.append(element('span','cu-metric-label',text));return el;
}

export function alignMetrics(container) {
  if(!container || !textMeasure)return;
  for(const label of container.querySelectorAll('.cu-metric-label')){
    const row=label.parentElement,svg=row.querySelector('svg');
    label.style.removeProperty('transform');svg?.style.removeProperty('transform');
    const bounds=row.getBoundingClientRect(),target=bounds.top+bounds.height/2;
    const style=getComputedStyle(label);
    const scale=label.getBoundingClientRect().height/(parseFloat(style.height)||20);
    textMeasure.font=[style.fontStyle,style.fontWeight,style.fontSize,style.fontFamily].join(' ');
    const text=label.textContent,font=[style.fontStyle,style.fontWeight,style.fontSize,style.fontFamily].join(' ');
    const width=textMeasure.measureText(text).width;
    const marker=element('span');marker.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline;margin:0;padding:0;border:0';
    label.append(marker);const baseline=marker.getBoundingClientRect().top;marker.remove();
    // 以当前缩放栅格化字形，保留基线的像素相位，避免字体回退和 hinting 造成高低差。
    const dpr=devicePixelRatio||1,pixelScale=dpr*scale,size=parseFloat(style.fontSize);
    textMeasure.canvas.width=Math.max(1,Math.ceil((width+8)*pixelScale));
    textMeasure.canvas.height=Math.ceil((size*4+8)*pixelScale);
    const reference=Math.ceil(size*2*pixelScale)+(baseline*dpr%1);
    textMeasure.setTransform(pixelScale,0,0,pixelScale,0,0);textMeasure.font=font;textMeasure.fillStyle='#fff';
    textMeasure.fillText(text,4,reference/pixelScale);
    const pixels=textMeasure.getImageData(0,0,textMeasure.canvas.width,textMeasure.canvas.height);
    let top=pixels.height,bottom=-1;
    for(let y=0;y<pixels.height;y++)for(let x=0;x<pixels.width;x++)if(pixels.data[(y*pixels.width+x)*4+3]>24){top=Math.min(top,y);bottom=Math.max(bottom,y);break;}
    const center=bottom<0?target:baseline+((top+bottom+1)/2-reference)/dpr;
    const shift=Math.round((target-center)*dpr)/dpr;
    label.style.transform=`translateY(${shift/scale}px)`;
    const glyphCenter=center+shift;
    if(svg){
      const box=svg.getBBox(),matrix=svg.getScreenCTM();
      const iconCenter=matrix.b*(box.x+box.width/2)+matrix.d*(box.y+box.height/2)+matrix.f;
      svg.style.transform=`translateY(${(glyphCenter-iconCenter)/scale}px)`;
    }
  }
}

export class MetricGroup {
  constructor(node, onActivate, onRemove) {
    this.node = node;
    this.onActivate = onActivate;
    this.onRemove = onRemove;
  }
  render(items) {
    const old = new Map([...this.node.children].map(node => [node.dataset.cuKey, node]));
    let changed = false;
    for (const text of [...this.node.childNodes]) if (text.nodeType === 3) { text.remove(); changed = true; }
    items.forEach((item, index) => {
      let button = old.get(item.key);
      old.delete(item.key);
      if (!button) {
        button = metric(item.icon, item.text, item.kind, item.turnId, this.onActivate);
        button.dataset.cuKey = item.key;
        changed = true;
      }
      button.dataset.cuKind = item.kind;
      button.dataset.cuTurn = item.turnId ?? '';
      const label = button.querySelector('.cu-metric-label');
      if (label.textContent !== item.text) { setText(label, item.text); changed = true; }
      button.setAttribute('aria-label', `${item.text}，点击查看详情`);
      button.toggleAttribute('data-cu-live', item.live === true);
      if (this.node.children[index] !== button) {
        this.node.insertBefore(button, this.node.children[index] ?? null);
        changed = true;
      }
    });
    for (const button of old.values()) { this.onRemove(button); button.remove(); changed = true; }
    if (changed) this.align();
  }
  mount(parent, before = null) {
    if (this.node.parentNode !== parent || this.node.nextSibling !== before) {
      parent.insertBefore(this.node, before);
      this.align();
    }
  }
  align() { alignMetrics(this.node); }
  dispose() { this.onRemove(this.node); this.node.remove(); }
}
