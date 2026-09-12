import {orderKey,summarizeOrders,boundEvents,safeUrl,clean,classifyPage} from './recorder-core.js';
import {createDesktopBridge} from './desktop-bridge.js';
const defaults={autoHistory:true};
let queue=Promise.resolve();
const tabMetrics=new Map();
const tabSessions=new Map(),activeTabsByWindow=new Map();
const panel=()=>chrome.tabs.create({url:chrome.runtime.getURL('recorder.html')});
chrome.action.onClicked.addListener(panel);

/**
 * The desktop companion, when one is running on this machine.
 *
 * The recorder's own contract does not change: every event is written to local storage and
 * printed to the console whether or not an app is listening. The link is best-effort in both
 * directions — a tick that cannot be delivered is dropped rather than queued, because a
 * message describing time observed minutes ago is no longer true, and this extension was
 * never designed to be a delivery-guaranteed transport.
 *
 * The worker is re-evaluated on every wake, so this reconnects on its own: `start()` is
 * idempotent and the module's backoff handles a desktop that is not running yet. While the
 * app is connected the worker also stays awake — Chrome resets the 30 s idle timer on any
 * WebSocket activity, and the kernel's `health.ping` arrives every 15 s, so the link holds
 * itself open instead of dropping on every idle period.
 */
const desktop=createDesktopBridge({
 extensionVersion:chrome.runtime.getManifest().version,
 onDecision:relayDecision,
 log:entry=>console.log(JSON.stringify({type:'desktop_bridge',...entry}))
});

/** A decision only means something to the tab it was decided about. */
function relayDecision(message){
 const tabId=message?.context?.tabId;
 if(!Number.isInteger(tabId))return;
 const type=message.type==='intervention.release'?'desktop-intervention-release':'desktop-intervention';
 chrome.tabs.sendMessage(tabId,{type,message}).catch(()=>{});
}

/**
 * Started at module scope so a worker that was asleep when the app came up reconnects on its
 * next wake. It is wrapped because this runs while the worker registers: a synchronous throw
 * here would take the recorder down with it, and no desktop link is worth losing the events.
 */
try{desktop.start();}catch(error){console.log(JSON.stringify({type:'desktop_bridge_start_failed',error:error.message}));}

async function settings(){return {...defaults,...(await chrome.storage.local.get('recorderSettings')).recorderSettings};}
async function sync(force=false){const s=await settings();const state=await chrome.storage.local.get(['historyTab','lastHistorySync']);if(state.historyTab){try{await chrome.tabs.get(state.historyTab);return {status:'already_running'};}catch{await chrome.storage.local.remove('historyTab');}}
 if(!force&&(!s.autoHistory||Date.now()-(state.lastHistorySync||0)<86400000))return {status:'not_due'};
 const tab=await chrome.tabs.create({url:'https://shopee.vn/user/purchase/?type=3',active:false});await chrome.storage.local.set({historyTab:tab.id,lastHistorySync:Date.now(),historyStatus:{status:'running',at:new Date().toISOString()}});await chrome.alarms.create('recorder-history-timeout',{delayInMinutes:1});return {status:'started'};
}
async function finish(status){const {historyTab}=await chrome.storage.local.get('historyTab');await chrome.storage.local.set({historyStatus:{status,at:new Date().toISOString()}});await chrome.storage.local.remove('historyTab');await chrome.alarms.clear('recorder-history-timeout');if(historyTab){try{const tab=await chrome.tabs.get(historyTab);if(tab.url?.startsWith('https://shopee.vn/user/purchase'))await chrome.tabs.remove(historyTab);}catch{}}}
function enrichAttention(event,tabId){
 if(event.type!=='attention_snapshot'||tabId===null)return event;
 const now=Date.parse(event.timestamp)||Date.now(),pageFocused=Math.max(0,event.data.totalFocusedMs||0),pageActive=Math.max(0,event.data.totalActiveMs||0);
 const metric=tabMetrics.get(tabId)||{createdAt:now,lastPageId:null,lastPageFocused:0,lastPageActive:0,totalFocusedMs:0,totalActiveMs:0};
 if(metric.lastPageId!==event.pageId){metric.lastPageId=event.pageId;metric.lastPageFocused=0;metric.lastPageActive=0;}
 metric.totalFocusedMs+=Math.max(0,pageFocused-metric.lastPageFocused);metric.totalActiveMs+=Math.max(0,pageActive-metric.lastPageActive);
 metric.lastPageFocused=pageFocused;metric.lastPageActive=pageActive;tabMetrics.set(tabId,metric);
 event.data={...event.data,tabLifetimeMs:Math.max(event.data.pageLifetimeMs||0,now-metric.createdAt),tabTotalFocusedMs:metric.totalFocusedMs,tabTotalActiveMs:metric.totalActiveMs,tabLifetimeMeasurement:'observed_since_extension_worker'};
 return event;
}
function siteForUrl(url){try{return new URL(url).hostname.toLowerCase();}catch{return null;}}
function tabSession(tab){
 const existing=tabSessions.get(tab.id);if(existing)return existing;
 const createdAt=Date.now(),next={createdAt,sessionId:crypto.randomUUID(),pageId:`browser-tab:${tab.id}:${createdAt}`};tabSessions.set(tab.id,next);return next;
}
async function recordTabFocus(tabId,focused,reason,relatedTabId=null){
 if(tabId===undefined||tabId===null)return;let tab;try{tab=await chrome.tabs.get(tabId);}catch{return;}
 const site=siteForUrl(tab.url);if(!site)return;
 const session=tabSession(tab),now=new Date().toISOString();
 const event={schemaVersion:'1.1',id:crypto.randomUUID(),timestamp:now,sessionId:session.sessionId,pageId:session.pageId,site,type:'tab_focus_changed',source:'browser_observation',page:{url:safeUrl(tab.url),title:clean(tab.title),siteType:classifyPage(tab.url,tab.title)},data:{focused,reason,relatedTabId:relatedTabId??null,tabLifetimeMs:Date.now()-session.createdAt}};
 await save(event,{tab:{id:tab.id}});
}
async function save(event,sender){if(!event||!/^1\.[01]$/.test(event.schemaVersion)||JSON.stringify(event).length>300000)return {error:'Invalid event'};event.tabId=sender.tab?.id??null;enrichAttention(event,event.tabId);const store=await chrome.storage.local.get(['recorderEvents','recorderOrders','recorderDropped']);const events=store.recorderEvents||[];events.push(event);const overflow=Math.max(0,events.length-2000),changes={recorderEvents:events.slice(-2000),recorderDropped:(store.recorderDropped||0)+overflow};if(event.type==='purchase_history_snapshot'){const orders=new Map((store.recorderOrders||[]).map(o=>[orderKey(o)||JSON.stringify([o.productId,o.name,o.variant]),o]));for(const o of event.data.rows||[])orders.set(orderKey(o)||JSON.stringify([o.productId,o.name,o.variant]),o);changes.recorderOrders=[...orders.values()].slice(-1000);changes.recorderSummary=summarizeOrders(changes.recorderOrders);}
 let derived=null;
 if(changes.recorderSummary){derived={...event,id:crypto.randomUUID(),type:'purchase_habits_updated',source:'automatic_analysis',data:{summary:changes.recorderSummary},inference:{isInference:true,method:'deduplicated_completed_order_lines',evidence:[event.id],caveat:'Partial history; repeat purchases require distinct verified order IDs.'}};changes.recorderEvents.push(derived);if(changes.recorderEvents.length>2000){changes.recorderEvents.shift();changes.recorderDropped++;}}
 const bounded=boundEvents(changes.recorderEvents);changes.recorderEvents=bounded.events;changes.recorderDropped+=bounded.dropped;await chrome.storage.local.set(changes);desktop.sendRecorderEvent(event,event.tabId);console.log(JSON.stringify(event));if(derived)console.log(JSON.stringify(derived));return {ok:true,event,derived};}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{if(sender.id!==chrome.runtime.id||!m.type?.startsWith('recorder-'))return;const isPanel=sender.url===chrome.runtime.getURL('recorder.html');queue=queue.catch(()=>{}).then(async()=>{switch(m.type){case 'recorder-event':return save(m.event,sender);case 'recorder-panel':await panel();return {ok:true};case 'recorder-shopee-visit':if(sender.tab)return sync();break;case 'recorder-ready':return {collect:sender.tab?.id===(await chrome.storage.local.get('historyTab')).historyTab};case 'recorder-sync-finished':if(sender.tab?.id===(await chrome.storage.local.get('historyTab')).historyTab)await finish(m.status);return {ok:true};case 'recorder-sync':if(isPanel)return sync(true);break;case 'recorder-clear':if(isPanel){await chrome.storage.local.remove(['recorderEvents','recorderOrders','recorderSummary','recorderDropped']);return {ok:true};}break;case 'recorder-settings':if(isPanel){const saved={autoHistory:!!m.settings?.autoHistory};await chrome.storage.local.set({recorderSettings:saved});return {ok:true};}break;}return {error:'Unsupported request'};}).then(respond,error=>respond({error:error.message}));return true;});
async function initialize(){await chrome.action.setBadgeText({text:'REC'});await chrome.action.setBadgeBackgroundColor({color:'#136558'});await chrome.alarms.create('recorder-history-daily',{periodInMinutes:1440});}
chrome.runtime.onInstalled.addListener(()=>initialize());chrome.runtime.onStartup.addListener(()=>{initialize();queue=queue.catch(()=>{}).then(()=>sync());});
chrome.alarms.onAlarm.addListener(a=>{queue=queue.catch(()=>{}).then(()=>a.name==='recorder-history-daily'?sync():a.name==='recorder-history-timeout'?finish('timeout_or_login_required'):null);});
chrome.tabs.onCreated.addListener(tab=>{if(tab.id!==undefined)tabMetrics.set(tab.id,{createdAt:Date.now(),lastPageId:null,lastPageFocused:0,lastPageActive:0,totalFocusedMs:0,totalActiveMs:0});});
chrome.tabs.onActivated.addListener(active=>{const previous=activeTabsByWindow.get(active.windowId);activeTabsByWindow.set(active.windowId,active.tabId);queue=queue.catch(()=>{}).then(async()=>{if(previous!==undefined&&previous!==active.tabId)await recordTabFocus(previous,false,'tab_deactivated',active.tabId);await recordTabFocus(active.tabId,true,previous===undefined?'tab_activated':'tab_switched',previous??null);});});
chrome.tabs.onRemoved.addListener(tabId=>{tabMetrics.delete(tabId);tabSessions.delete(tabId);for(const [windowId,activeTabId] of activeTabsByWindow)if(activeTabId===tabId)activeTabsByWindow.delete(windowId);});
