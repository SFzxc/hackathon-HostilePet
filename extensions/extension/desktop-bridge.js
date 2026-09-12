const PROTOCOL_VERSION=1;
const DEFAULT_URL='ws://127.0.0.1:54321';
const SENSOR={packId:'browser',name:'session.tick',schema:'signal.session.tick@1'};

function id(){return crypto.randomUUID();}
function epoch(value){const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:Date.now();}
function site(value){try{const host=new URL(value||'').hostname.toLowerCase();return host.includes('.')?host:undefined;}catch{return undefined;}}
function pageType(value){const normalized=String(value||'').toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');return /^[a-z][a-z0-9-]{0,31}$/.test(normalized)?normalized:undefined;}

export function createDesktopBridge({url=DEFAULT_URL,extensionVersion='1.0.0',WebSocketImpl=globalThis.WebSocket,onDecision=()=>{},log=()=>{},reconnect=true}={}){
 let socket=null,state='disconnected',retry=0,timer=null;
 const documents=new Map();
 const envelope=(type,payload,context)=>({protocolVersion:PROTOCOL_VERSION,messageId:id(),timestamp:Date.now(),type,...(context?{context}:{}),payload});
 const emit=(event,detail={})=>log({event,...detail});
 function schedule(){if(!reconnect||timer)return;const delay=[1000,2000,5000][Math.min(retry++,2)];timer=setTimeout(()=>{timer=null;connect();},delay);}
 function receive(raw){let message;try{message=JSON.parse(typeof raw.data==='string'?raw.data:String(raw.data));}catch{emit('desktop.bridge.invalid-json');return;}
  if(message.type==='welcome'){state='ready';retry=0;emit('desktop.bridge.ready',{messageId:message.messageId});return;}
  if(message.type==='health.ping'&&socket?.readyState===WebSocketImpl.OPEN){socket.send(JSON.stringify(envelope('health.pong',{})));return;}
  if(message.type==='intervention.request'||message.type==='intervention.release'){emit('desktop.bridge.decision',{type:message.type,messageId:message.messageId,leaseId:message.payload?.lease?.leaseId||message.payload?.leaseId});onDecision(message);return;}
  if(message.type==='reject')emit('desktop.bridge.rejected',{reason:message.payload?.reason});
 }
 function connect(){if(!WebSocketImpl||state==='connecting'||state==='ready')return;state='connecting';emit('desktop.bridge.connecting',{url});socket=new WebSocketImpl(url);
  socket.addEventListener('open',()=>{socket.send(JSON.stringify(envelope('hello',{protocolVersion:PROTOCOL_VERSION,extensionVersion,sensors:[SENSOR],capabilities:['surface.bubble','surface.overlay']})));});
  socket.addEventListener('message',receive);
  socket.addEventListener('close',()=>{state='disconnected';socket=null;emit('desktop.bridge.disconnected');schedule();});
  socket.addEventListener('error',()=>emit('desktop.bridge.error'));
 }
 function sendRecorderEvent(event,tabId){if(state!=='ready'||!socket||socket.readyState!==WebSocketImpl.OPEN||!event||!Number.isInteger(tabId)||tabId<0)return false;
  const documentId=String(event.pageId||'').slice(0,128);if(!documentId)return false;
  const current=documents.get(documentId)||{seq:0,lastActiveMs:0};const total=Math.max(0,Number(event.data?.totalActiveMs??event.data?.tabTotalActiveMs??0)||0);const activeMs=Math.min(30000,Math.max(0,total-current.lastActiveMs));current.seq+=1;current.lastActiveMs=Math.max(current.lastActiveMs,total);documents.set(documentId,current);
  const context={tabId,documentId,windowFocused:event.type!=='tab_focus_changed'||event.data?.focused!==false};
  const payload={activeMs,seq:current.seq,active:context.windowFocused,visible:true,idle:event.data?.interactionState==='idle'};const host=site(event.page?.url)||site(`https://${event.site||''}`);const kind=pageType(event.page?.siteType);if(host)payload.site=host;if(kind)payload.pageType=kind;
  const message=envelope('signal.browser.session.tick',payload,context);socket.send(JSON.stringify(message));emit('desktop.bridge.signal-sent',{messageId:message.messageId,tabId,documentId});return true;
 }
 function stop(){reconnect=false;if(timer)clearTimeout(timer);timer=null;socket?.close();socket=null;state='disconnected';}
 return {start:connect,stop,sendRecorderEvent,status:()=>state};
}
