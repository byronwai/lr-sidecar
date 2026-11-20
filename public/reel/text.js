const clusters = new Intl.Segmenter(undefined,{granularity:'grapheme'});
export const graphemes = text => Array.from(clusters.segment(text),s=>s.segment);

export function displayValue(value, decimals=0) {
  const text=Number(value).toFixed(decimals);
  return Number(text)===0 ? (0).toFixed(decimals) : text.replace(/^-/,'−');
}

export function ellipsize(text,fits) {
  const chars=graphemes(text.trimEnd());
  while(chars.length && !fits(chars.join('').trimEnd()+'…'))chars.pop();
  return chars.join('').replace(/[\s·∪∩×+−]+$/u,'')+'…';
}

// A line break can separate list or union members. Differences, intersections
// and counts stay with their operands, and the caption keeps the full expression.
export function labelLines(ctx,text,width,font){
  ctx.font=font;
  const fits=s=>ctx.measureText(s).width<=width;
  const [first,...rest]=text.split(/ ([·∪]) /u);
  const lines=[first];
  for(let i=0;i<rest.length;i+=2){
    const last=lines.length-1,item=rest[i+1];
    const joined=lines[last]+' '+rest[i]+' '+item;
    if(fits(joined))lines[last]=joined;
    else if(lines.length===1 && fits(lines[0]))lines.push(item);
    else{
      lines[last]=ellipsize(lines[last],fits);
      return lines;
    }
  }
  return lines.map(line=>fits(line)?line:ellipsize(line,fits));
}

