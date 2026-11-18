import assert from 'node:assert/strict';

// Shared by the browser integration test and both fixture evidence runs.
export async function regressionChecks(evaluate, call) {
  const slider = await evaluate(`(()=>{
    const range=document.querySelector('#compare');
    return [10,35,50,80].map(value=>{
      range.value=value;range.dispatchEvent(new Event('input',{bubbles:true}));
      const canvas=document.querySelector('#compare-before'),r=canvas.getBoundingClientRect();
      const right=parseFloat(getComputedStyle(canvas).clipPath.split(' ')[1]);
      const edge=r.left+r.width*(1-right/100);
      const center=s=>{const b=document.querySelector(s).getBoundingClientRect();return b.left+b.width/2};
      return {value,edge,divider:center('.compare-divider'),handle:center('.compare-divider span')};
    });
  })()`);
  for (const row of slider) {
    assert.ok(Math.abs(row.edge-row.divider)<=1,JSON.stringify(row));
    assert.ok(Math.abs(row.edge-row.handle)<=1,JSON.stringify(row));
  }
  await evaluate("document.querySelector('#compare').value=50;document.querySelector('#compare').dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evaluate("document.querySelectorAll('.slice').length"),await evaluate('lrc.state.groups.length'));
  await evaluate("document.querySelector('#compile').focus()");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await evaluate("document.activeElement.matches('.slice-label')"),true,'Tab must reach the first slice control');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  const end=Date.now()+10000;
  while(!await evaluate("document.querySelector('#output-name').textContent.startsWith('Pass 0')")) {
    assert.ok(Date.now()<end,'Enter on a focused pass must inspect it');
    await new Promise(r=>setTimeout(r,50));
  }
  await evaluate("document.querySelector('#show-final').click()");
  const reel = await evaluate(`(async()=>{
    const {canvas,frame}=await lrcReel.makeRenderer();
    const timeline=lrcReel.prepare().timeline,count=Math.round(timeline.duration*30);
    const first=frame(0),rect=first.photoRect;
    let maxDeviation=0,emptyPanelFrames=0,unsafe=0,sliceFrames=0;
    for(let i=0;i<count;i++) {
      const m=frame(i/30);
      maxDeviation=Math.max(maxDeviation,...Object.keys(rect).map(k=>Math.abs(m.photoRect[k]-rect[k])));
      if(['hook','rewind','loop'].includes(m.scene)&&m.panelDrawn)emptyPanelFrames++;
      unsafe+=Number(m.text.some(t=>t.left<60||t.right>960||t.top<250||t.bottom>1480));
      if(m.slices.length) {
        if(m.slices.length!==timeline.chapterCount||m.slices.length>5)throw Error('Wrong chosen slice count');
        sliceFrames++;
      }
    }
    const hold=timeline.schedule.find(c=>c.scene==='hold');
    if(!hold)throw Error('Fixture must contain a hold for pixel proof');
    const times=[hold.t0+.2,hold.t0+.4];
    const x=canvas.getContext('2d',{willReadFrequently:true});
    frame(times[0]);const a=x.getImageData(0,0,1080,1920).data;
    frame(times[1]);const b=x.getImageData(0,0,1080,1920).data;
    let changedPixels=0,maxChannelDelta=0,pixels=0;
    for(let y=Math.ceil(rect.y+2);y<Math.floor(rect.y+rect.h-2);y++)for(let xx=Math.ceil(rect.x+2);xx<Math.floor(rect.x+rect.w-2);xx++) {
      // Exclude only the approved panel and its chrome/caret footprint.
      if(xx>=53&&xx<=947&&y>=1132&&y<=1471)continue;
      const p=(y*1080+xx)*4;
      const delta=Math.max(...[0,1,2].map(k=>Math.abs(a[p+k]-b[p+k])));
      pixels++;if(delta)changedPixels++;maxChannelDelta=Math.max(maxChannelDelta,delta);
    }
    return {frames:count,rect,maxDeviation,emptyPanelFrames,unsafe,sliceFrames,
      hookFonts:first.text.filter(t=>t.text!=='/ framebuffer').map(t=>t.font),
      hold:{times,pixels,changedPixels,maxChannelDelta}};
  })()`);
  assert.equal(reel.maxDeviation,0);
  assert.equal(reel.emptyPanelFrames,0);
  assert.equal(reel.unsafe,0);
  assert.ok(reel.hookFonts.length&&reel.hookFonts.every(f=>f.includes('Reel Display')));
  assert.equal(reel.hold.changedPixels,0);
  assert.equal(reel.hold.maxChannelDelta,0);
  console.log('REGRESSIONS',JSON.stringify({slider,reel}));
  return {slider,reel,keyboardInspection:true};
}
