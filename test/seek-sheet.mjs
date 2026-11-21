export async function decode() {
  const result = await lrcReel.export();
  const video = document.querySelector('#reel-preview');
  if (!video.videoWidth) await new Promise((ok,fail)=>{
    const timer=setTimeout(()=>fail(Error('Export metadata timed out')),20000);
    video.addEventListener('loadedmetadata',()=>{clearTimeout(timer);ok();},{once:true});
    video.addEventListener('error',()=>{clearTimeout(timer);fail(Error(video.error.message));},{once:true});
    video.preload='auto';video.load();
  });
  const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  video.pause();
  const count = result.frames;
  if (!count) throw Error('Expected a WebCodecs export');
  const indices = Array.from({length:Math.ceil(count/15)}, (_,i)=>i*15).concat(count-1);
  const sheet = document.createElement('canvas');
  sheet.width = 8*180;
  sheet.height = Math.ceil(indices.length/8)*344;
  const grid = sheet.getContext('2d');
  grid.fillStyle = '#080d18';
  grid.fillRect(0,0,sheet.width,sheet.height);
  grid.font = '14px monospace';
  grid.fillStyle = 'white';
  let first, loopMax = 0;

  for (const [i,index] of indices.entries()) {
    await new Promise((ok,fail) => {
      const timer=setTimeout(()=>fail(Error('Seek timed out at frame '+index)),20000);
      video.addEventListener('seeked',()=>{clearTimeout(timer);ok();},{once:true});
      video.currentTime = (index+.5)/30;
    });
    if(video.seeking||video.readyState<2)throw Error('Incomplete video seek');
    ctx.drawImage(video,0,0);
    const x = i%8*180, y = Math.floor(i/8)*344;
    grid.drawImage(canvas,x,y,180,320);
    grid.fillText((index/30).toFixed(2)+' s',x+6,y+338);
    if (i===0 || i===indices.length-1) {
      const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
      if (!i) first = pixels;
      if (i===indices.length-1) for(let j=0;j<pixels.length;j++) loopMax=Math.max(loopMax,Math.abs(first[j]-pixels[j]));
    }
  }
  const {schedule,duration}=lrcReel.prepare().timeline;
  return {schedule:schedule.map(({scene,t0,t1,title})=>({scene,t0,t1,title})),duration,frames:count,loopMax,
    sheet:sheet.toDataURL('image/jpeg',.94).split(',')[1]};
}
