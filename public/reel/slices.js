// Optional Reel motif. Uses the captured page mask faces, never the renderer.
// The affine matrix is rotateX(62deg) rotateZ(-35deg), as on the page.
export function createSlices(schedule) {
  const chapters = schedule.filter(cue => cue.scene === 'program').slice(0, 5);
  const mono = '500 25px "Reel Mono", "Noto Sans TC Variable", monospace';
  return {
    draw(ctx, cue, time, arrive, text) {
      if (!chapters.length || !['rewind', 'camera', 'program'].includes(cue.scene)) return [];
      ctx.save();
      ctx.fillStyle = '#080e1ef2';
      ctx.fillRect(80, 450, 858, 310 + (chapters.length - 1) * 94);
      ctx.strokeStyle = '#7894ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(145, 524);
      ctx.quadraticCurveTo(510, 450, 892, 524);
      ctx.stroke();
      text(ctx, 'composite passes → encode ↗', 160, 496, mono, '#c4d4ff');
      const shown = [];
      chapters.forEach((chapter, i) => {
        const active = cue.scene === 'program' && chapter.pass.index === cue.pass.index;
        // Arrives on the answer beat, then hands off to the flat-photo wipe.
        const lift = active ? arrive(time, cue.t1) : 0;
        const center = { x: 300 + 38 * lift, y: 640 + i * 94 - 64 * lift };
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.transform(.819152, -.269278, .573576, .384569, 0, 0);
        ctx.fillStyle = '#04070f';
        ctx.fillRect(-125, -187.5, 250, 375);
        if (chapter.pass.mask) ctx.drawImage(chapter.pass.mask, -125, -187.5, 250, 375);
        ctx.strokeStyle = chapter.pass.color;
        ctx.lineWidth = active ? 4 : 2;
        ctx.strokeRect(-125, -187.5, 250, 375);
        ctx.restore();
        const label = `pass ${chapter.pass.index} · ${chapter.pass.name}`;
        const chars = Array.from(label);
        const lines = [chars.slice(0, 26).join(''), chars.slice(26, 52).join('')].filter(Boolean);
        const y = 620 + i * 94;
        if (active) {
          ctx.fillStyle = chapter.pass.color;
          ctx.fillRect(526, y - 27, 394, lines.length * 30 + 6);
        }
        lines.forEach((line, row) => text(ctx, line, 534, y + row * 30, mono, active ? '#04070f' : chapter.pass.color, 378));
        shown.push({ index: chapter.pass.index, active, lift, center });
      });
      ctx.restore();
      return shown;
    }
  };
}
