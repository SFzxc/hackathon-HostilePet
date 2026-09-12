export function parsePrice(value){if(typeof value==='number')return value>0?value:null;if(typeof value!=='string')return null;const s=value.trim().replace(/[₫đ\s]/gi,'');if(!/^\d[\d.,]*$/.test(s))return null;const n=Number(s.replace(/[.,](?=\d{3}(?:[.,]|$))/g,''));return Number.isFinite(n)&&n>0?n:null;}
export function extract(doc=document,url=location.href){
 const products=[];
 const visit=(v)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(visit);return;}if(v['@type']==='Product'||Array.isArray(v['@type'])&&v['@type'].includes('Product'))products.push(v);if(v['@graph'])visit(v['@graph']);};
 for(const script of doc.querySelectorAll('script[type="application/ld+json"]')){try{visit(JSON.parse(script.textContent));}catch{}}
 const normalized=u=>{try{const v=new URL(u,url);return v.origin+v.pathname;}catch{return '';}};
 const matching=products.filter(p=>p.url&&normalized(p.url)===normalized(url));
 const product=matching.length===1?matching[0]:products.length===1?products[0]:null;
 const ambiguous=products.length>1&&!product;
 const offers=product?.offers;const offer=Array.isArray(offers)?null:offers;
 const name=String(product?.name||doc.querySelector('h1')?.textContent||doc.querySelector('meta[property="og:title"]')?.content||'Sản phẩm chưa xác định').trim().slice(0,200);
 const meta=doc.querySelector('meta[property="product:price:amount"],meta[itemprop="price"]');
 const visiblePrices=[...doc.querySelectorAll('[itemprop="price"]:not(meta),[data-testid="product-price"],[aria-label="Giá"],[aria-label="Price"]')].filter(n=>!n.closest?.('del,s,[hidden],[aria-hidden="true"]')).map(n=>parsePrice(n.getAttribute?.('content')??n.textContent)).filter(n=>n!==null);
 const uniquePrices=[...new Set(visiblePrices)];const currentPriceVerified=uniquePrices.length===1&&!ambiguous;
 const price=ambiguous?null:currentPriceVerified?uniquePrices[0]:parsePrice(offer?.price??meta?.content??null);
 const variant=[...doc.querySelectorAll('button[aria-pressed="true"],button[aria-checked="true"],[role="radio"][aria-checked="true"],[role="option"][aria-selected="true"]')].map(n=>String(n.textContent||'').trim().slice(0,100)).join('|');
 const quantityInput=doc.querySelector('input[aria-label="Số lượng"],input[aria-label="Quantity"],input[role="spinbutton"]');
 const parsedQuantity=Number(quantityInput?.value);const quantity=Number.isInteger(parsedQuantity)&&parsedQuantity>0?parsedQuantity:1;
 return {name,price,quantity,variant,currentPriceVerified,url,category:'other',discount:0,source:currentPriceVerified?'current semantic price':product?'JSON-LD':'semantic DOM',confidence:price?'medium':'low',key:JSON.stringify([url,name,price,quantity,variant])};
}
