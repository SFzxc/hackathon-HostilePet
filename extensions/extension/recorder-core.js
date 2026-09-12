export const clean = (s, n=240) => String(s??'').replace(/\s+/g,' ').trim().slice(0,n);
export function safeUrl(raw){try{const u=new URL(raw);if(!/^https?:$/.test(u.protocol))return null;u.username='';u.password='';u.hash='';for(const k of [...u.searchParams.keys()])if(!['keyword','q','query','type','itemid','shopid'].includes(k))u.searchParams.delete(k);return u.href;}catch{return null;}}
export function categoryOf(name){const t=clean(name).toLowerCase();for(const [value,re] of [['electronics',/tai nghe|điện thoại|laptop|mouse|bàn phím|chuột máy tính|keyboard|bluetooth|máy tính/],['fashion',/áo |quần |giày|túi xách|dress|shirt/],['beauty',/son môi|kem dưỡng|mỹ phẩm|serum/],['home',/nồi |chảo|đèn |bàn |ghế /],['groceries',/sữa |cà phê|bánh |coffee/]])if(re.test(t))return {value,source:'keyword_heuristic',confidence:0.6};return {value:'unknown',source:'insufficient_evidence',confidence:0};}
export function inferIntent(type,data){const rules={search_submitted:['researching',0.55],search_query_observed:['researching',0.5],product_view:['exploring',0.4],product_dwell:['considering',0.6],product_hover:['exploring',0.35],cart_click:['planning_purchase',0.75],buy_click:['purchase_imminent',0.85],checkout_click:['purchase_imminent',0.9]};if(!rules[type])return null;return {stage:rules[type][0],confidence:rules[type][1],isInference:true,method:'rules_v1',subject:data.product?.name||data.query||null,evidence:[{eventType:type,activeMs:data.activeMs??null}],caveat:'Behavioral signal only; not a confirmed intention or purchase.'};}
export const orderKey=o=>o.orderId&&o.productId?JSON.stringify([o.orderId,o.productId,o.variant||'']):null;
export function summarizeOrders(rows){const unique=new Map();let unverifiedRows=0;for(const o of rows){const key=orderKey(o);if(key)unique.set(key,o);else unverifiedRows++;}const complete=[...unique.values()].filter(o=>o.status==='completed');const products=new Map();for(const o of complete){const p=products.get(o.productId)||{productId:o.productId,name:o.name,units:0,orders:new Set(),category:categoryOf(o.name)};p.units+=(Number.isInteger(o.quantity)&&o.quantity>0&&o.quantityVerified!==false?o.quantity:0);p.orders.add(o.orderId);products.set(o.productId,p);}return {basis:'observed_completed_order_lines_only',distinctOrders:new Set(complete.map(o=>o.orderId)).size,completedUnits:complete.reduce((s,o)=>s+(Number.isInteger(o.quantity)&&o.quantity>0&&o.quantityVerified!==false?o.quantity:0),0),unverifiedRows,unknownQuantityLines:complete.filter(o=>!Number.isInteger(o.quantity)||o.quantity<=0||o.quantityVerified===false).length,products:[...products.values()].map(p=>({...p,orders:p.orders.size,repeatPurchase:p.orders.size>1})),limitations:'Partial rendered history. No frequency or spend estimate without verified dates and prices.'};}
export function boundEvents(rows,maxCount=2000,maxBytes=6000000){let bytes=2,index=rows.length;const encoder=new TextEncoder();while(index>0&&rows.length-index<maxCount){const size=encoder.encode(JSON.stringify(rows[index-1])).length+1;if(bytes+size>maxBytes)break;bytes+=size;index--;}return {events:rows.slice(index),dropped:index};}

export function parseShopeeIdentity(raw){
 try{
  const u=new URL(raw),match=u.pathname.match(/-i\.(\d+)\.(\d+)(?:\/|$)|\/product\/(\d+)\/(\d+)(?:\/|$)/i);
  return {shopId:match?.[1]||match?.[3]||null,productId:match?.[2]||match?.[4]||null};
 }catch{return {shopId:null,productId:null};}
}

export function parseMoney(value){
 if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
 if(typeof value!=='string')return null;
 const candidate=value.trim().replace(/[₫đ\s]/gi,'');
 if(!/^\d[\d.,]*$/.test(candidate))return null;
 const normalized=candidate.replace(/[.,](?=\d{3}(?:[.,]|$))/g,'');
 const number=Number(normalized);
 return Number.isFinite(number)&&number>=0?number:null;
}

export function parsePriceRange(value){
 if(typeof value!=='string'){const price=parseMoney(value);return {min:price,max:price};}
 const prices=[...value.matchAll(/(?:₫\s*)?\d[\d.,]*(?:\s*[₫đ])?/gi)].map(match=>parseMoney(match[0])).filter(Number.isFinite);
 if(!prices.length)return {min:null,max:null};
 return {min:Math.min(...prices),max:Math.max(...prices)};
}

const emptyInteractions=()=>({pointerMoves:0,pointerDistance:0,clicks:0,scrolls:0,keydowns:0});
export function createAttentionState(now=Date.now()){
 return {startedAt:now,lastSampleAt:now,lastInteractionAt:now,isFocused:false,isActive:false,focusStartedAt:null,activeStartedAt:null,totalFocusedMs:0,totalActiveMs:0,idleThresholdMs:60000,interactions:emptyInteractions()};
}

export function reduceAttention(previous,sample){
 const now=Math.max(previous.lastSampleAt,Number(sample.now));
 const threshold=Number.isFinite(sample.idleThresholdMs)?Math.max(1000,sample.idleThresholdMs):previous.idleThresholdMs;
 const interactions={...previous.interactions};
 for(const key of Object.keys(interactions))interactions[key]+=Math.max(0,Number(sample[key])||0);
 let totalFocusedMs=previous.totalFocusedMs,totalActiveMs=previous.totalActiveMs;
 if(previous.isFocused)totalFocusedMs+=now-previous.lastSampleAt;
 if(previous.isActive)totalActiveMs+=Math.max(0,Math.min(now,previous.lastInteractionAt+threshold)-previous.lastSampleAt);
 const interacted=!!sample.interacted||Object.keys(interactions).some(key=>(Number(sample[key])||0)>0);
 const lastInteractionAt=interacted?now:previous.lastInteractionAt;
 const isFocused=!!sample.visible&&!!sample.focused;
 const isActive=isFocused&&now-lastInteractionAt<=threshold;
 const focusStartedAt=isFocused?(previous.isFocused?previous.focusStartedAt:now):null;
 const activeStartedAt=isActive?(previous.isActive?previous.activeStartedAt:now):null;
 return {...previous,lastSampleAt:now,lastInteractionAt,isFocused,isActive,focusStartedAt,activeStartedAt,totalFocusedMs,totalActiveMs,idleThresholdMs:threshold,interactions};
}

export function attentionSnapshot(state,now=state.lastSampleAt){
 const interactionState=!state.isFocused?'background':state.isActive?'active':'idle';
 return {pageLifetimeMs:Math.max(0,now-state.startedAt),continuousFocusMs:state.isFocused?Math.max(0,now-state.focusStartedAt):0,totalFocusedMs:state.totalFocusedMs,continuousActiveMs:state.isActive?Math.max(0,Math.min(now,state.lastInteractionAt+state.idleThresholdMs)-state.activeStartedAt):0,totalActiveMs:state.totalActiveMs,idleForMs:Math.max(0,now-state.lastInteractionAt),idleThresholdMs:state.idleThresholdMs,interactionState,interactions:{...state.interactions}};
}

export function classifyPage(rawUrl,title=''){
 let host='',path='';try{const url=new URL(rawUrl);host=url.hostname.toLowerCase();path=url.pathname.toLowerCase();}catch{return 'other';}
 const matches=(domains)=>domains.some(domain=>host===domain||host.endsWith(`.${domain}`));
 if(matches(['shopee.vn','lazada.vn','tiki.vn','amazon.com','ebay.com','aliexpress.com','taobao.com','temu.com','shein.com']))return 'shopping';
 if(matches(['youtube.com','netflix.com','spotify.com','tiktok.com','twitch.tv','disneyplus.com','soundcloud.com']))return 'entertainment';
 if(matches(['github.com','gitlab.com','notion.so','slack.com','linear.app','atlassian.net','figma.com','office.com','zoom.us'])||matches(['google.com'])&&/(docs|drive|calendar|mail)/.test(host+path))return 'work';
 if(matches(['facebook.com','x.com','twitter.com','instagram.com','reddit.com','linkedin.com']))return 'social';
 if(matches(['vnexpress.net','tuoitre.vn','thanhnien.vn','bbc.com','cnn.com','nytimes.com']))return 'news';
 if(matches(['tradingview.com','coinmarketcap.com','coingecko.com','binance.com']))return 'finance';
 return /\b(invoice|dashboard|project|workspace)\b/i.test(title)?'work':'other';
}
