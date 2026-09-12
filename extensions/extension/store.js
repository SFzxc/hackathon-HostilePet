export const storageKey='guardian-v1';
const month=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
export const fresh=()=>({profile:{name:'Bạn',budget:3000000,spent:0,spentMonth:month(),goal:'Mua ít hơn, dùng nhiều hơn',tone:'friendly'},orders:[],events:[],saved:[],demo:false});
let baseline=fresh();
export function manualSpent(profile,date=new Date()){return profile.spentMonth===month(date)?profile.spent:0;}
export function mergeChanges(current,base,next){
 const merged=structuredClone(current);
 for(const key of Object.keys(next)){
  if(JSON.stringify(base[key])===JSON.stringify(next[key]))continue;
  if(['events','saved'].includes(key)){
   const id=v=>v.id||JSON.stringify(v);const old=new Map((base[key]||[]).map(v=>[id(v),v]));const updates=new Map(next[key].map(v=>[id(v),v]));
   merged[key]=(current[key]||[]).filter(v=>!old.has(id(v))||updates.has(id(v))).map(v=>updates.get(id(v))||v);
   const present=new Set(merged[key].map(id));for(const [k,v] of updates)if(!present.has(k))merged[key].push(v);
  }else merged[key]=structuredClone(next[key]);
 }return merged;
}
export async function read(){try{const v=globalThis.chrome?.storage?(await chrome.storage.local.get(storageKey))[storageKey]:JSON.parse(localStorage.getItem(storageKey));const data=v?.profile&&Array.isArray(v.orders)?v:fresh();baseline=structuredClone(data);return data;}catch{const data=fresh();baseline=structuredClone(data);return data;}}
export async function write(v,{reset=false}={}){
 const next=structuredClone(v),base=structuredClone(baseline);let result;
 if(globalThis.chrome?.storage){const response=await chrome.runtime.sendMessage({type:'guardian-write',base,next,reset});if(response?.error)throw Error(response.error);result=response.data;}
 else {const current=JSON.parse(localStorage.getItem(storageKey))||fresh();result=reset?next:mergeChanges(current,base,next);localStorage.setItem(storageKey,JSON.stringify(result));}
 baseline=structuredClone(result);Object.assign(v,result);return result;
}
export function monthlySpent(orders){return orders.filter(o=>o.date.startsWith(month())).reduce((s,o)=>s+o.price,0);}
