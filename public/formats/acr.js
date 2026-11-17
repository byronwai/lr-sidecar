import {
  readTIFF,
  bytesOf,
  array
} from './tiff.js';
export function md5(input) {
  const data = bytesOf(input),
  padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 128;
  const v = new DataView(padded.buffer);
  v.setUint32(padded.length - 8, (data.length * 8) >>> 0, true);
  v.setUint32(padded.length - 4, Math.floor(data.length / 0x20000000), true);
  const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21],
  k = Array.from({
    length:64
  },(_,i)=>(Math.abs(Math.sin(i+1))*4294967296)>>>0);
  let a0=0x67452301,
  b0=0xefcdab89,
  c0=0x98badcfe,
  d0=0x10325476;
  for(let p=0;p<padded.length;p+=64){
    let a=a0,
    b=b0,
    c=c0,
    d=d0;
    for(let i=0;i<64;i++){
      let f,
      g;
      if(i<16){
        f=(b&c)|(~b&d);
        g=i;
      }else if(i<32){
        f=(d&b)|(~d&c);
        g=(5*i+1)%16;
      }else if(i<48){
        f=b^c^d;
        g=(3*i+5)%16;
      }else{
        f=c^(b|~d);
        g=(7*i)%16;
      }
      const q=(a+f+k[i]+v.getUint32(p+g*4,true))|0,
      s=shifts[Math.floor(i/16)*4+i%4];
      a=d;
      d=c;
      c=b;
      b=(b+((q<<s)|(q>>>(32-s))))|0;
    }
    a0=(a0+a)|0;
    b0=(b0+b)|0;
    c0=(c0+c)|0;
    d0=(d0+d)|0;
  }
  const out=new Uint8Array(16),
  ov=new DataView(out.buffer);
  [a0,b0,c0,d0].forEach((x,i)=>ov.setInt32(i*4,x,true));
  return hex(out);
}
const hex = b => Array.from(b,x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
export function parseACR(input) {
  const bytes=bytesOf(input),
  v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length),
  str=(o,n)=>String.fromCharCode(...bytes.subarray(o,o+n));
  if(bytes.length<20||str(0,4)!=='ACR\0')throw new Error('Not an ACR companion file');
  const version=v.getUint32(4,true),
  count=v.getUint32(12,true),
  reserved=v.getUint32(16,true);
  if(version!==1)throw new Error(`Unsupported ACR version ${version}`);
  if(count>10000||20+count*32>bytes.length)throw new Error('Truncated ACR record table');
  const records=[];
  for(let i=0;i<count;i++){
    const p=20+i*32,
    id=hex(bytes.subarray(p,p+16)),
    size=Number(v.getBigUint64(p+16,true)),
    offset=Number(v.getBigUint64(p+24,true));
    if(!Number.isSafeInteger(size)||!Number.isSafeInteger(offset)||offset<20+count*32||offset+size>bytes.length||size<4)throw new Error(`Invalid ACR bounds for ${id}`);
    const data=bytes.subarray(offset,offset+size),
    r={
      id,
      size,
      offset,
      kind:'receipt',
      actualMD5:md5(data)
    };
    r.md5Match=r.actualMD5===id;
    if(size>=24&&data[0]===2&&data[4]===1&&data.subarray(1,4).every(x=>x===0)&&data.subarray(5,16).every(x=>x===0)){
      r.kind='raster';
      const tiff=readTIFF(data.subarray(16)),
      t=tiff.ifds[0].tags;
      Object.assign(r,{
        width:t[256],
        height:t[257],
        channels:t[277]||1,
        photometric:t[262],
        compression:t[259],
        tileWidth:t[322],
        tileHeight:t[323],
        tileOffsets:array(t[324]),
        tileByteCounts:array(t[325]),
        tiffOffset:offset+16
      });
      if(!r.width||!r.height||r.width*r.height>1e8||!r.tileWidth||!r.tileHeight||r.tileOffsets.length!==r.tileByteCounts.length)throw new Error(`Invalid raster layout ${id}`);
      if(r.compression!==52546)throw new Error(`Unsupported ACR compression ${r.compression}`);
      const expected=Math.ceil(r.width/r.tileWidth)*Math.ceil(r.height/r.tileHeight);
      if(r.tileOffsets.length!==expected)throw new Error(`Incomplete tile grid ${id}`);
      r.tileOffsets.forEach((o,j)=>{
        if(o<0||o+r.tileByteCounts[j]>size-16)throw new Error(`Tile out of bounds ${id}`);
      });
      if(!r.md5Match)throw new Error(`Raster MD5 mismatch ${id}`);
    }else r.uncompressedLength=new DataView(data.buffer,data.byteOffset,data.length).getUint32(0,true);
    records.push(r);
  }
  return {
    version,
    source:str(8,4).replace(/\0/g,''),
    count,
    reserved,
    records
  };
}
export async function inflateReceipt(input, record) {
  if(record.uncompressedLength>64*1024*1024)throw new Error('Receipt exceeds 64 MiB');
  const bytes=bytesOf(input),
  stream=new Blob([bytes.subarray(record.offset+4,record.offset+record.size)]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader=stream.getReader(),
  chunks=[];
  let size=0;
  for(;;){
    const {
      value,
      done
    }=await reader.read();
    if(done)break;
    size+=value.length;
    if(size>record.uncompressedLength){
      await reader.cancel();
      throw new Error('Receipt exceeds declared length');
    }
    chunks.push(value);
  }
  if(size!==record.uncompressedLength)throw new Error('Receipt inflated length mismatch');
  const payload=new Uint8Array(size);
  let p=0;
  for(const c of chunks){
    payload.set(c,p);
    p+=c.length;
  }
  if(size<12)throw new Error('Missing receipt prefix');
  return {
    prefix:hex(payload.subarray(0,12)),
    xml:new TextDecoder().decode(payload.subarray(12)),
    length:size
  };
}
