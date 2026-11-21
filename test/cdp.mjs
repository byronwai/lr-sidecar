// Small dependency-free CDP client shared by browser export measurements.
export async function connect(targetId=process.env.LR_CDP_TARGET){
  const tabs=await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json());
  const tab=targetId?tabs.find(t=>t.id===targetId):tabs.find(t=>t.type==='page'&&/^http/.test(t.url));
  if(!tab)throw new Error('Open the playtest page in Chrome on port 9223');
  const ws=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map(),events=[];let id=0;
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else events.push(m);};
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params,sessionId}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async(expression,timeout=180000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,250));}throw Error('Timeout: '+expression);};
  return {call,evaluate,until,events,close:()=>ws.close(),tab};
}
