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
    this.separation=0;
    this.positions=[];
    this.drag=null;
    this.ignoreClick=false;
    this.expanded=false;
    this.animations=[];
    this.captionIndex=0;
    element.tabIndex=0;
    element.setAttribute('role','group');
    element.setAttribute('aria-label','Pass stack. Enter or Space to expand or collapse. Escape to collapse.');
    this.toggle=document.createElement('button');
    this.toggle.type='button';
    this.toggle.className='stack-toggle';
    this.toggle.setAttribute('aria-controls',element.id);
    element.before(this.toggle);
    this.toggle.addEventListener('click',()=>this.setExpanded(!this.expanded));
    this.toggle.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();this.setExpanded(false);}
    });
    element.addEventListener('click',e=>{
      if(this.ignoreClick||this.animating)return;
      if(!this.expanded)this.setExpanded(true);
      else if(!e.target.closest('button'))this.setExpanded(false);
    });
    element.addEventListener('keydown',e=>{
      if(e.target===element&&['Enter',' '].includes(e.key)){
        e.preventDefault();this.setExpanded(!this.expanded);
      }
      if(e.key==='Escape'){
        e.preventDefault();this.setExpanded(false);this.toggle.focus();
      }
    });
    this.setExpanded(false);
    element.addEventListener('pointerdown',e=>{
      if(!this.expanded||this.animating||e.button!==0||e.target.closest('.slice-label'))return;
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
    this.reduced.addEventListener('change',()=>{
      if(this.reduced.matches)this.animations.forEach(animation=>animation.finish());
    });
  }
  setGroups(groups){
    this.cancelMotion();
    this.groups=groups;
    this.captionIndex=0;
    this.el.style.setProperty('--count',groups.length);
    this.el.innerHTML=`<div class="stack-world"></div><div class="beam"></div><p class="fan-caption" aria-live="polite" aria-atomic="true"></p>`;
    const world=this.el.querySelector('.stack-world');
    groups.forEach((g,i)=>{
      const style=`--i:${i+(6-groups.length)/2};--color:${g.color}`,
      plane=document.createElement('button');
      plane.className=`slice placeholder ${g.kind==='parametric'?'parametric':''}`;
      plane.tabIndex=-1;
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
      label.innerHTML=`<span class="pass-chip" aria-hidden="true">${i}</span><strong><span class="pass-name">pass ${i} · ${escape(g.name)}</span><span class="timing"></span></strong><span class="source">${escape(g.source)}</span><span class="params">${g.parameters.map(line=>`<span class="param-line">${escape(line)}</span>`).join('')}</span>`;
      this.el.append(label);
      label.addEventListener('focus',()=>{plane.classList.add('focused');this.caption(i);});
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
          this.caption(i);
          this.el.classList.add('hovering');
          plane.classList.add('focused');
          label.classList.add('focused');
        });
        node.addEventListener('pointerleave',()=>{
          this.el.classList.remove('hovering');
          plane.classList.remove('focused');
          label.classList.remove('focused');
        });
        node.addEventListener('click',event=>{
          event.stopPropagation();
          if(this.ignoreClick||this.animating)return;
          this.caption(i);
          if(this.expanded)this.onSelect(i);
          else this.setExpanded(true,i);
        });
      }
      plane.addEventListener('focus',()=>{plane.classList.add('focused');this.caption(i);});
      plane.addEventListener('blur',()=>plane.classList.remove('focused'));
    });
    this.layout();
    this.caption(0);
  }
  caption(index){
    this.captionIndex=index;
    const group=this.groups[index],caption=this.el.querySelector('.fan-caption');
    if(!group||!caption)return;
    const timing=this.el.querySelectorAll('.timing')[index]?.textContent;
    caption.textContent=`pass ${index} · ${group.name}${timing?` · ${timing}`:''}`;
    caption.style.setProperty('--color',group.color);
  }
  select(index){
    if(index!==null)this.caption(index);
    this.el.querySelectorAll('.slice-label').forEach((label,i)=>label.setAttribute('aria-pressed',String(i===index)));
    this.el.querySelectorAll('.slice').forEach((plane,i)=>plane.classList.toggle('inspected',i===index));
  }
  async setExpanded(expanded,inspectIndex){
    if(this.animating||expanded===this.expanded&&this.el.classList.contains('packed')===!expanded)return;
    const slices=[...this.el.querySelectorAll('.slice')];
    const labels=[...this.el.querySelectorAll('.slice-label')];
    const before=slices.map(slice=>getComputedStyle(slice).transform);
    const labelBefore=labels.map(label=>label.getBoundingClientRect());
    const height=this.el.getBoundingClientRect().height;
    const column=this.el.closest('.passes-column');
    const columnHeight=column.getBoundingClientRect().height;
    const world=this.el.querySelector('.stack-world');
    const orbit=world&&getComputedStyle(world).transform;
    this.ignoreClick=false;
    this.drag=null;
    this.el.querySelectorAll('.focused').forEach(node=>node.classList.remove('focused'));
    this.expanded=expanded;
    if(!expanded){this.el.style.setProperty('--orbit','0deg');this.el.style.setProperty('--tilt','0deg');}
    this.el.classList.toggle('packed',!expanded);
    this.el.closest('.passes-column').classList.toggle('stack-packed',!expanded);
    this.toggle.textContent=expanded?'Collapse passes ↑':'Expand passes ↓';
    this.toggle.setAttribute('aria-expanded',String(expanded));
    // Layout both endpoints synchronously. The matrices include the fan's scale
    // and isometric projection, so the same canvas travels without a crossfade.
    this.layout();
    this.el.nextElementSibling.inert=!expanded;
    if(!this.reduced.matches&&slices.length){
      this.animating=true;
      this.el.classList.add('stack-moving');
      const easing=getComputedStyle(this.el).getPropertyValue('--ease').trim();
      const stagger=Math.min(30,210/Math.max(1,slices.length-1));
      const duration=560-stagger*(slices.length-1);
      const animate=(node,frames,delay=0,ms=duration)=>{
        const animation=node.animate(frames,{duration:ms,delay,easing,fill:'both'});
        this.animations.push(animation);
      };
      slices.forEach((slice,i)=>{
        const delay=(expanded?i:slices.length-1-i)*stagger;
        animate(slice,[{transform:before[i]},{transform:getComputedStyle(slice).transform}],delay);
        const to=labels[i].getBoundingClientRect(),from=labelBefore[i];
        animate(labels[i],[{transform:`translate(${from.x-to.x}px,${from.y-to.y}px)`},{transform:'none'}],delay);
        // Keep both label treatments during travel: the chip hands over to
        // the row on expansion, and the row hands back to the chip on return.
        for(const child of labels[i].children){
          const chip=child.classList.contains('pass-chip');
          const fromOpacity=chip===expanded?1:0;
          animate(child,[{opacity:fromOpacity},{opacity:1-fromOpacity}],delay);
        }
      });
      // Account for the disclosure's controls appearing/disappearing, so the
      // pane's outer height starts at exactly its previous value.
      const controlsDelta=column.getBoundingClientRect().height-columnHeight-(this.el.getBoundingClientRect().height-height);
      // Grow with the bottom card, and only shrink when that card returns.
      // Otherwise the first card can outrun the pane and cross its controls.
      animate(this.el,[{height:`${Math.max(0,height-controlsDelta)}px`},{height:this.el.style.height}],expanded?0:stagger*(slices.length-1));
      animate(world,[{transform:orbit},{transform:getComputedStyle(world).transform}],0,560);
      if(!expanded)animate(this.el.querySelector('.fan-caption'),[{opacity:0},{opacity:1}],410,150);
      const motion=this.animations;
      await Promise.all(motion.map(animation=>animation.finished.catch(()=>{})));
      // A new file can replace the deck before its motion completes.
      if(this.animations!==motion)return;
      this.cancelMotion();
      this.layout();
    }
    if(inspectIndex!==undefined){
      labels[inspectIndex]?.focus({preventScroll:true});
      this.onSelect(inspectIndex);
    }
  }
  cancelMotion(){
    this.animations.forEach(animation=>animation.cancel());
    this.animations=[];
    this.animating=false;
    this.el.classList.remove('stack-moving');
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
    if(this.animating)return;
    const labels=[...this.el.querySelectorAll('.slice-label')];
    const slices=[...this.el.querySelectorAll('.slice')];
    if(!labels.length)return;
    this.el.classList.remove('packed');
    // Below the default spread the deck tightens; labels condense to one line
    // so rows can close up without text colliding (full params on hover/inspect).
    this.el.classList.toggle('tight',this.separation<22);
    const desktop=matchMedia('(min-width: 821px)').matches;
    if(matchMedia('(max-width: 600px)').matches){
      this.el.style.height='auto';
      const expandedHeight=this.el.getBoundingClientRect().height;
      // Keep the narrow-screen text rows. Each card docks beside its own row.
      this.positions=labels.map(label=>label.offsetTop+12);
      this.finishLayout(expandedHeight,labels,slices);
      return;
    }
    let top=40;
    this.positions=[];
    const heights=labels.map(label=>Math.ceil(label.getBoundingClientRect().height));
    const lastRow=Math.max(heights[0],slices[0].offsetHeight*.3+12);
    const rowHeights=heights.slice(1).map(height=>Math.max(desktop?80:90,height+20));
    const naturalHeight=top+lastRow+rowHeights.reduce((total,height)=>total+height,0);
    const controls=this.el.nextElementSibling;
    const sideBottom=Math.max(...this.sideColumns.map(column=>column.getBoundingClientRect().bottom));
    const available=Math.max(620,desktop?sideBottom-this.el.getBoundingClientRect().top-controls.offsetHeight:0);
    // Separation 22–100 keeps the original spread (fill the column, then widen).
    // Below 22 the deck tightens toward 0, where rows are ~30% closer than the
    // old minimum and the slices overlap; label text never collides.
    const fill=Math.max(0,available-naturalHeight)/Math.max(1,labels.length-1);
    const meanRow=rowHeights.length?rowHeights.reduce((a,b)=>a+b,0)/rowHeights.length:0;
    const tight=Math.min(1,this.separation/22);
    const spacing=this.separation>=22?fill+(this.separation-22)*.65:fill*tight-(1-tight)*.15*meanRow;
    for(let i=labels.length-1;i>=0;i--){
      labels[i].style.top=`${top}px`;
      const center=top+12;
      slices[i].style.setProperty('--y',`${center}px`);
      this.positions[i]=center;
      if(i>0)top+=Math.max(heights[i]+6,rowHeights[i-1]+spacing);
    }
    const minimum=matchMedia('(max-width:1100px)').matches?440:470;
    const height=Math.ceil(Math.max(minimum,this.separation>=22?available:0,top+lastRow));
    this.finishLayout(height,labels,slices);
    this.el.style.setProperty('--collapse-y',`${this.positions.at(-1)}px`);
  }
  finishLayout(height,labels,slices){
    const width=this.el.clientWidth;
    const mobile=matchMedia('(max-width:600px)').matches;
    const world=this.el.querySelector('.stack-world');
    const origin=world.offsetLeft;
    labels.forEach(label=>label.style.setProperty('--row-width',`${label.getBoundingClientRect().width}px`));
    const planeWidth=slices[0].offsetWidth,planeHeight=slices[0].offsetHeight;
    const projectedWidth=planeWidth*Math.cos(35*Math.PI/180)+planeHeight*Math.sin(35*Math.PI/180);
    const projectedHeight=(planeWidth*Math.sin(35*Math.PI/180)+planeHeight*Math.cos(35*Math.PI/180))*Math.cos(62*Math.PI/180);
    // Budget for chips and the single caption before choosing the card scale.
    // Short, tight stacks still pack to roughly 30% on a phone.
    // Expanded: zoom the deck out so every slice stays inside the pane, between
    // its left edge and the label column, and clears the pane's top edge.
    let fit=1;
    if(this.expanded&&!mobile&&labels.length){
      const labelLeft=labels[0].getBoundingClientRect().left-this.el.getBoundingClientRect().left;
      const half=Math.max(30,Math.min(origin-12,labelLeft-origin-10));
      fit=Math.min(1,half/(projectedWidth/2));
      const clear=projectedHeight*fit/2+10-Math.min(...this.positions);
      if(clear>0){
        this.positions=this.positions.map(y=>y+clear);
        labels.forEach(label=>{label.style.top=`${parseFloat(label.style.top||0)+clear}px`;});
        height+=clear;
      }
    }
    this.fit=fit;
    const fanWidth=Math.min(mobile?125:170,width*.48,Math.max(16,height*.3-78)*projectedWidth/projectedHeight);
    const scale=fanWidth/projectedWidth;
    const step=labels.length>1?Math.min(fanWidth*.48,(width-fanWidth-24)/(labels.length-1)):0;
    const start=(width-fanWidth-step*(labels.length-1))/2+fanWidth/2;
    const lanes=step>0?Math.ceil(22/step):1;
    const fanHeight=projectedHeight*scale;
    const contentHeight=fanHeight+lanes*24+54;
    const packedHeight=Math.ceil(Math.max(height*.3,contentHeight));
    const y=Math.max(fanHeight/2+14,(packedHeight-lanes*24-34)/2);
    const chipY=y+fanHeight/2+10;
    this.el.classList.toggle('packed',!this.expanded);
    this.el.style.height=`${this.expanded?Math.ceil(height):packedHeight}px`;
    this.el.style.setProperty('--expanded-height',`${height}px`);
    this.el.closest('.passes-column').style.setProperty('--packed-height',`${packedHeight}px`);
    this.el.style.setProperty('--caption-y',`${chipY+lanes*24+8}px`);
    slices.forEach((slice,i)=>{
      slice.style.setProperty('--x',`${this.expanded?0:start+step*i-origin}px`);
      slice.style.setProperty('--y',`${this.expanded?this.positions[i]:y}px`);
      slice.style.setProperty('--scale',this.expanded?(mobile?.3:fit):scale);
      slice.style.zIndex=i+1;
    });
    labels.forEach((label,i)=>{
      label.style.setProperty('--chip-x',`${start+step*i-10}px`);
      label.style.setProperty('--chip-y',`${chipY+(i%lanes)*24}px`);
      label.tabIndex=0;
    });
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
    if(index===this.captionIndex)this.caption(index);
  }
  async finish(){
    this.el.classList.remove('running');
    this.el.querySelectorAll('.hit').forEach(n=>n.classList.remove('hit'));
    await this.wait(1500);
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
