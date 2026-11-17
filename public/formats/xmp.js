const CRS='http://ns.adobe.com/camera-raw-settings/1.0/';
const scalar = (s,key='') => /Digest|SyncID|^pm_patch|^IngestInfo/.test(key) ? s : /^(true|false)$/i.test(s) ? s.toLowerCase()==='true' : /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s.trim()) ? Number(s) : s;
// Minimal non-validating XML tree for the Node self-test only. Browsers always use DOMParser.
function fallbackTree(xml) {
  const root={
    name:'#document',
    attrs:{},
    children:[],
    text:''
  },
  stack=[root];
  const unescape=s=>s.replace(/&(?:amp|lt|gt|quot|apos);/g,x=>({
    '&amp;':'&',
    '&lt;':'<',
    '&gt;':'>',
    '&quot;':'"',
    '&apos;':"'"
  }[x]));
  for(const m of xml.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/[\w:.-]+\s*>|<[\w:.-]+\b[^>]*>|[^<]+/g)){
    const s=m[0];
    if(s.startsWith('<?')||s.startsWith('<!--'))continue;
    if(s.startsWith('</')){
      if(stack.length>1)stack.pop();
      continue;
    }
    if(s.startsWith('<')){
      const n={
        name:s.match(/^<([\w:.-]+)/)[1],
        attrs:{},
        children:[],
        text:''
      };
      for(const a of s.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g))n.attrs[a[1]]=unescape(a[3]);
      stack.at(-1).children.push(n);
      if(!s.endsWith('/>'))stack.push(n);
    }
    else stack.at(-1).text+=unescape(s.trim());
  }
  return root;
}
function domTree(el){
  return {
    name:el.nodeName,
    attrs:Object.fromEntries(Array.from(el.attributes||[],a=>[a.namespaceURI===CRS?'crs:'+a.localName:a.name,a.value])),
    text:Array.from(el.childNodes||[]).filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(''),
    children:Array.from(el.children||[],domTree)
  };
}
const find=(n,name)=>n.children.find(c=>c.name===name);
const all=(n,name)=>[...(n.name===name?[n]:[]),...n.children.flatMap(c=>all(c,name))];
function value(n){
  if(Object.keys(n.attrs).some(k=>k.startsWith('crs:')))return resource(n);
  if(!n.children.length)return scalar(n.text,n.name.split(':').at(-1));
  const seq=n.children.find(c=>['rdf:Seq','rdf:Bag','rdf:Alt'].includes(c.name));
  if(seq)return seq.children.map(c=>Object.keys(c.attrs).some(k=>k.startsWith('crs:'))||c.children.some(x=>x.name==='rdf:Description')?resource(c):value(c));
  return resource(n);
}
function resource(n){
  const d=find(n,'rdf:Description');
  if(d)return resource(d);
  const out={};
  for(const [k,v]of Object.entries(n.attrs))if(k.startsWith('crs:')||k==='tiff:Orientation')out[k.split(':')[1]]=scalar(v,
  k.split(':')[1]);
  for(const c of n.children)if(c.name.startsWith('crs:')||c.name==='tiff:Orientation')out[c.name.split(':')[1]]=value(c);
  return out;
}
export function parseXMP(input, Parser=globalThis.DOMParser){
  let tree;
  if(typeof input==='string'){
    if(!input.includes('xmpmeta')||!input.includes('rdf:Description'))throw new Error('Not a Camera Raw XMP document');
    if(Parser){
      const doc=new Parser().parseFromString(input,'application/xml');
      if(doc.getElementsByTagName('parsererror').length)throw new Error('Malformed XMP XML');
      tree=domTree(doc.documentElement);
    }else tree=fallbackTree(input);
  }else{
    if(input.getElementsByTagName('parsererror').length)throw new Error('Malformed XMP XML');
    tree=domTree(input.documentElement);
  }
  const desc=all(tree,'rdf:Description').find(n=>Object.keys(n.attrs).some(k=>k.startsWith('crs:'))||n.children.some(c=>c.name.startsWith('crs:')));
  if(!desc)throw new Error('No Camera Raw settings found');
  const raw=resource(desc),
  corrections=raw.MaskGroupBasedCorrections||[],
  remove=raw.RemoveAreas||[];
  if(!Array.isArray(corrections)||!Array.isArray(remove))throw new Error('Invalid XMP correction sequence');
  const globals=Object.fromEntries(Object.entries(raw).filter(([k])=>!['MaskGroupBasedCorrections','RemoveAreas'].includes(k)));
  return {
    capturedAt: desc.attrs['exif:DateTimeOriginal'] ?? desc.children.find(c => c.name === 'exif:DateTimeOriginal')?.text ?? null,
    globals,
    corrections:corrections.map((c,i)=>({
      ...c,
      name:c.CorrectionName||`Correction ${i+1}`,
      masks:c.CorrectionMasks||[]
    })),
    remove,
    orientation:Number(raw.Orientation)||null,
    raw
  };
}
export function recordUsage(settings){
  const uses=new Map();
  const add=(id,label)=>{
    if(typeof id==='string'&&/^[A-Fa-f0-9]{32}$/.test(id)){
      id=id.toUpperCase();
      uses.set(id,[...new Set([...(uses.get(id)||[]),label])]);
    }
  };
  function masks(list,label){
    for(const m of list||[]){
      add(m.MaskDigest,`${label}: ${m.MaskName||m.What}`);
      masks(m.Gesture,label);
    }
  }
  for(const c of settings.corrections)masks(c.masks,c.name);
  settings.remove.forEach((r,i)=>{
    add(r.pm_patch,`Remove ${i+1} chosen`);
    add(r.pm_patch_mask,`Remove ${i+1} blend mask`);
    for(const v of r.pm_patch_variations||[])add(v.pm_patch_variation,`Remove ${i+1} alternative`);
    masks(r.Masks,`Remove ${i+1} selection`);
  });
  return uses;
}
