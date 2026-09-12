const PROTOCOL_VERSION=1;
const DEFAULT_URL='ws://127.0.0.1:54321';
const SENSOR={packId:'browser',name:'session.tick',schema:'signal.session.tick@1'};
/**
 * The recorder reports `attention_snapshot` once a second, so two consecutive reports can
 * never legitimately sit more than one cadence apart. A larger jump means reports were missed —
 * the worker restarted, or the app connected late — and that gap is time nobody reported in
 * increments. A tick therefore claims at most one cadence rather than the whole cumulative
 * total: crediting minutes the desktop never received would be fabrication, which
 * non-negotiable 6 forbids.
 *
 * `REPORT_INTERVAL_MS` MUST track the recorder's own gate (`recorder.js`,
 * `lastAttentionEmit`): it is a restatement of that cadence, and if the two drift, ticks start
 * under- or over-claiming. Under-claiming is the safe direction — the measured time is real,
 * so dropping some of it is honest, while inventing it is not.
 *
 * This is the transport's resolution, not the desktop's attention span. Every tick is
 * accrued, but three slower clocks decide what becomes visible: the kernel throttles what
 * reaches the event log (`observeThrottleMs`), the turn runner settles a burst before asking
 * the model, and the model decides what to say. A finer tick buys accuracy in the accrual —
 * one tick can no longer mis-tag a whole 30 s window — not more log lines or more calls.
 */
const REPORT_INTERVAL_MS=1000;
/**
 * Only the recorder events that carry a change in observed time or focus become ticks.
 *
 * `content_impression` fires once per visible feed post, so forwarding everything would spend
 * the bridge's whole rate budget on messages claiming zero milliseconds — and
 * `docs/architecture.md` §6 counts qualifying time, not activity.
 */
const TICK_TYPES=new Set(['attention_snapshot','visibility_changed','tab_focus_changed','page_session_ended']);

function id(){return crypto.randomUUID();}
function epoch(value){const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:Date.now();}
function site(value){try{const host=new URL(value||'').hostname.toLowerCase();return host.includes('.')?host:undefined;}catch{return undefined;}}
function pageType(value){const normalized=String(value||'').toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');return /^[a-z][a-z0-9-]{0,31}$/.test(normalized)?normalized:undefined;}

/**
 * The four qualification inputs the kernel ANDs together, read from what the recorder saw.
 *
 * `attentionSnapshot` collapses visibility, focus and idleness into `interactionState`, so
 * every value here is a fact this extension already established: `active` means visible,
 * focused and not idle; `idle` means visible and focused but quiet; `background` means the
 * page was neither visible nor focused. Nothing is optimistic on purpose — the kernel must be
 * able to reject time we never observed, and this is the only place that knows.
 *
 * Two different quantities live in one tick and they must not be confused:
 *
 *   `activeMs`          how long the page was attentive *across the interval* since the last
 *                       tick. The recorder accrues it only while the page was visible,
 *                       focused and inside its idle threshold, so a positive delta is itself
 *                       an attestation that all four kernel conditions held.
 *   `interactionState`  the state at the *instant* the tick was taken.
 *
 * Qualifying the interval with the instant throws away observed time, because the two are
 * anti-correlated by construction: the recorder emits a tick exactly when something changed,
 * so the snapshot carrying a large delta is usually the one taken just after the window lost
 * focus, while the snapshots taken while it was focused carry a delta of zero. Measured on
 * this machine: 3050 ms and 4035 ms of genuinely attentive time arrived tagged `background`,
 * and every tick tagged `active` carried 0 ms, so the kernel credited nothing at all.
 *
 * A tick that measured time therefore qualifies on its measurement. A tick that measured
 * nothing falls back to the instant, which cannot credit time either way and so can afford to
 * stay pessimistic: `active` is false wherever the state does not say otherwise, and a tick
 * carrying no measurement never has one inferred for it.
 *
 * One type outranks all of it. `page_session_ended` is a page saying it is gone, and it says so
 * while `pagehide` still finds the document briefly measurable — so without the guard below it
 * takes the `measured` branch and reports itself as visible and focused. A closed tab claiming
 * to be in front of the person is worse than one that says nothing at all: the kernel keeps the
 * site present, the pet keeps the face it earned there, and the site goes on feeding the
 * escalation level long after nobody is looking at it.
 */
function qualification(event,measured){
  if(event.type==='page_session_ended')return {windowFocused:false,active:false,visible:false,idle:false};
  if(measured)return {windowFocused:true,active:true,visible:true,idle:false};
 const state=event.data?.interactionState;
 if(state==='active')return {windowFocused:true,active:true,visible:true,idle:false};
 if(state==='idle')return {windowFocused:true,active:false,visible:true,idle:true};
 if(state==='background')return {windowFocused:false,active:false,visible:false,idle:false};
 if(event.type==='visibility_changed'){const visible=event.data?.visible!==false;return {windowFocused:visible,active:false,visible,idle:false};}
 const focused=event.type!=='tab_focus_changed'||event.data?.focused!==false;
 return {windowFocused:focused,active:false,visible:focused,idle:false};
}

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
  if(!TICK_TYPES.has(event.type))return false;
  const documentId=String(event.pageId||'').slice(0,128);if(!documentId)return false;
  const seen=documents.get(documentId),current=seen||{seq:0,lastActiveMs:0};const total=Math.max(0,Number(event.data?.totalActiveMs??event.data?.tabTotalActiveMs??0)||0);const delta=Math.max(0,total-current.lastActiveMs);const activeMs=Math.min(REPORT_INTERVAL_MS,delta);current.seq+=1;current.lastActiveMs=Math.max(current.lastActiveMs,total);documents.set(documentId,current);
  const q=qualification(event,activeMs>0);
  const context={tabId,documentId,windowFocused:q.windowFocused};
  const payload={activeMs,seq:current.seq,active:q.active,visible:q.visible,idle:q.idle};const host=site(event.page?.url)||site(`https://${event.site||''}`);const kind=pageType(event.page?.siteType);if(host)payload.site=host;if(kind)payload.pageType=kind;
  const message=envelope('signal.browser.session.tick',payload,context);socket.send(JSON.stringify(message));emit('desktop.bridge.signal-sent',{messageId:message.messageId,tabId,documentId,activeMs,site:host,pageType:kind});return true;
 }
 function stop(){reconnect=false;if(timer)clearTimeout(timer);timer=null;socket?.close();socket=null;state='disconnected';}
 return {start:connect,stop,sendRecorderEvent,status:()=>state};
}
