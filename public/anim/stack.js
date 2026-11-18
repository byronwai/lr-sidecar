const escape=s=>String(s).replace(/[&<>"']/g,c=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
}[c]));
export class SliceStack {
  constructor(element,onSelect){
    this.el=element;
    this.onSelect=onSelect;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    this.groups=[];
    this.separation=22;
    this.positions=[];
    this.drag=null;
    this.ignoreClick=false;
    element.addEventListener('pointerdown',e=>{
      if(e.button!==0||e.target.closest('.slice-label'))return;
      this.drag={
        x:e.clientX,
        y:e.clientY
      };
      this.ignoreClick=false;
    });
    element.addEventListener('pointermove',e=>{
      if(!this.drag)return;
      const dx=e.clientX-this.drag.x;
      if(Math.abs(dx)>5){
        this.ignoreClick=true;
        element.setPointerCapture(e.pointerId);
      }
      element.style.setProperty('--orbit',`${Math.max(-16,Math.min(16,dx*.13))}deg`);
      element.style.setProperty('--tilt',`${Math.max(-7,Math.min(7,(e.clientY-this.drag.y)*.07))}deg`);
    });
    element.addEventListener('pointerup',()=>{
      this.drag=null;
    });
    element.addEventListener('pointercancel',()=>{
      this.drag=null;
    });
    this.resizeObserver=new ResizeObserver(()=>this.scheduleLayout());
    this.resizeObserver.observe(element);
    this.sideColumns=[...element.closest('.pipeline').querySelectorAll('.input-column,.output-column')];
    this.sideColumns.forEach(column=>this.resizeObserver.observe(column));
    document.fonts?.ready.then(()=>this.scheduleLayout());
  }
  setGroups(groups){
    this.groups=groups;
    this.el.style.setProperty('--count',groups.length);
    this.el.innerHTML=`<svg class="stack-arc" viewBox="0 0 600 110" aria-hidden="true"><path d="M 100 90 Q 355 -55 590 65"/><text x="350" y="60">composite passes → encode ↗</text></svg><div class="stack-world"></div><div class="beam"></div>`;
    const world=this.el.querySelector('.stack-world');
    groups.forEach((g,i)=>{
      const style=`--i:${i+(6-groups.length)/2};--color:${g.color}`,
      plane=document.createElement('button');
      plane.className=`slice placeholder ${g.kind==='parametric'?'parametric':''}`;
      plane.tabIndex=-1;
      plane.setAttribute('aria-hidden','true');
      plane.style.cssText=style;
      plane.setAttribute('aria-label',`Inspect pass ${i}: ${g.name}`);
      plane.innerHTML='<canvas width="195" height="283"></canvas>';
      world.append(plane);
      const label=document.createElement('button');
      label.type='button';
      label.disabled=true;
      plane.disabled=true;
      label.className='slice-label';
      label.setAttribute('aria-label',`Inspect pass ${i}: ${g.name}`);
      label.setAttribute('aria-pressed','false');
      label.style.cssText=style;
      label.title=[g.name,...g.parameters].join('\n');
      label.innerHTML=`<strong>pass ${i} · ${escape(g.name)}<span class="timing"></span></strong><span class="source">${escape(g.source)}</span><span class="params">${g.parameters.map(line=>`<span class="param-line">${escape(line)}</span>`).join('')}</span>`;
      this.el.append(label);
      label.addEventListener('focus',()=>plane.classList.add('focused'));
      label.addEventListener('blur',()=>plane.classList.remove('focused'));
      label.addEventListener('keydown',event=>{
        if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
        event.preventDefault();
        const labels=[...this.el.querySelectorAll('.slice-label')];
        const next=event.key==='Home'?0:event.key==='End'?labels.length-1:Math.max(0,Math.min(labels.length-1,i+(event.key==='ArrowDown'?1:-1)));
        labels[next].focus();
      });
      for(const node of [plane,label]){
        node.addEventListener('pointerenter',()=>{
          this.el.classList.add('hovering');
          plane.classList.add('focused');
          label.classList.add('focused');
        });
        node.addEventListener('pointerleave',()=>{
          this.el.classList.remove('hovering');
          plane.classList.remove('focused');
          label.classList.remove('focused');
        });
        node.addEventListener('click',()=>{
          if(!this.ignoreClick)this.onSelect(i);
        });
      }
      plane.addEventListener('focus',()=>plane.classList.add('focused'));
      plane.addEventListener('blur',()=>plane.classList.remove('focused'));
    });
    this.layout();
  }
  select(index){
    this.el.querySelectorAll('.slice-label').forEach((label,i)=>label.setAttribute('aria-pressed',String(i===index)));
    this.el.querySelectorAll('.slice').forEach((plane,i)=>plane.classList.toggle('inspected',i===index));
  }
  available(enabled){
    this.el.querySelectorAll('.slice,.slice-label').forEach(button=>button.disabled=!enabled);
  }
  setSeparation(value){
    this.separation=value;
    this.el.style.setProperty('--separation',`${value}px`);
    this.layout();
  }
  scheduleLayout(){
    cancelAnimationFrame(this.layoutFrame);
    this.layoutFrame=requestAnimationFrame(()=>this.layout());
  }
  layout(){
    const labels=[...this.el.querySelectorAll('.slice-label')];
    const slices=[...this.el.querySelectorAll('.slice')];
    if(!labels.length)return;
    const desktop=matchMedia('(min-width: 821px)').matches;
    if(matchMedia('(max-width: 600px)').matches){
      this.el.style.height='auto';
      return;
    }
    let top=110;
    this.positions=[];
    const heights=labels.map(label=>Math.ceil(label.getBoundingClientRect().height));
    const lastRow=Math.max(heights[0],slices[0].offsetHeight*.3+12);
    const rowHeights=heights.slice(1).map(height=>Math.max(desktop?80:90,height+20));
    const naturalHeight=top+lastRow+rowHeights.reduce((total,height)=>total+height,0);
    const controls=this.el.nextElementSibling;
    const sideBottom=Math.max(...this.sideColumns.map(column=>column.getBoundingClientRect().bottom));
    const available=Math.max(620,desktop?sideBottom-this.el.getBoundingClientRect().top-controls.offsetHeight:0);
    const spacing=Math.max(0,available-naturalHeight)/Math.max(1,labels.length-1)+(this.separation-22)*.65;
    for(let i=labels.length-1;i>=0;i--){
      labels[i].style.top=`${top}px`;
      const center=top+12;
      slices[i].style.setProperty('--y',`${center}px`);
      this.positions[i]=center;
      if(i>0)top+=rowHeights[i-1]+spacing;
    }
    const height=Math.ceil(Math.max(available,top+lastRow));
    if(this.el.style.height!==`${height}px`)this.el.style.height=`${height}px`;
    this.el.style.setProperty('--collapse-y',`${this.positions.at(-1)}px`);
  }
  face(index,bitmap){
    const plane=this.el.querySelectorAll('.slice')[index];
    if(!plane){
      bitmap.close();
      return;
    }
    const c=plane.querySelector('canvas');
    c.width=bitmap.width;
    c.height=bitmap.height;
    c.getContext('2d').drawImage(bitmap,0,0);
    bitmap.close();
    plane.classList.remove('placeholder');
  }
  enabled(index,enabled){
    this.el.querySelectorAll('.slice')[index]?.classList.toggle('disabled',!enabled);
  }
  async begin(){
    this.el.classList.remove('collapsing','flying','typing');
    this.el.classList.add('assembling');
    const input=document.getElementById('input-frame');
    input.classList.remove('slicing');
    void input.offsetWidth;
    input.classList.add('slicing');
    await this.wait(320);
    this.el.querySelectorAll('.slice').forEach((p,i)=>{
      p.style.transitionDelay=`${i*75}ms`;
    });
    this.el.classList.remove('assembling');
    this.el.classList.add('typing');
    await this.wait(900);
    this.el.querySelectorAll('.slice').forEach(p=>p.style.transitionDelay='');
    this.el.classList.add('running');
  }
  start(index){
    this.el.querySelectorAll('.hit').forEach(n=>n.classList.remove('hit'));
    this.el.querySelectorAll('.slice')[index]?.classList.add('hit');
    this.el.querySelectorAll('.slice-label')[index]?.classList.add('hit');
    this.el.querySelector('.beam').style.top=`${this.positions[index]}px`;
  }
  done(index,ms){
    const label=this.el.querySelectorAll('.slice-label')[index];
    if(label)label.querySelector('.timing').textContent=`${ms.toFixed(0)} ms`;
  }
  async finish(){
    this.el.classList.remove('running');
    this.el.querySelectorAll('.hit').forEach(n=>n.classList.remove('hit'));
    this.el.classList.add('collapsing');
    await this.wait(650);
    this.el.classList.add('flying');
    await this.wait(850);
    this.el.classList.remove('collapsing','flying');
    const out=document.getElementById('output-frame');
    out.classList.remove('reveal','encoding');
    void out.offsetWidth;
    out.classList.add('reveal');
  }
  wait(ms){
    return new Promise(resolve=>setTimeout(resolve,this.reduced.matches?0:ms));
  }
}
