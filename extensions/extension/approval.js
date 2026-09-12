export const APPROVAL_TTL=20*60*1000;
export function productIdentity(p){
 try{const u=new URL(p.url);const match=u.pathname.match(/-i\.(\d+)\.(\d+)(?:\/|$)/)||u.pathname.match(/^\/product\/(\d+)\/(\d+)(?:\/|$)/);return match?`${u.origin}/product/${match[1]}/${match[2]}`:u.origin+u.pathname.replace(/\/$/,'');}catch{return null;}
}
export function purchaseTotal(p){return Number.isFinite(p.price)&&p.price>0?p.price*(Number.isInteger(p.quantity)&&p.quantity>0?p.quantity:1):null;}
export function createApproval(p,now=Date.now()){return {identity:productIdentity(p),total:purchaseTotal(p),variant:p.variant||'',until:now+APPROVAL_TTL};}
export function approvalStatus(a,p,now=Date.now()){
 if(!a||!a.identity||a.identity!==productIdentity(p)||a.until<=now)return 'new';
 if((p.variant||'')!==a.variant&&p.currentPriceVerified!==true)return 'changed';
 const total=purchaseTotal(p);
 if(total===null&&a.total===null)return 'approved';
 if(total===null||a.total===null||total>a.total)return 'changed';
 return 'approved';
}
