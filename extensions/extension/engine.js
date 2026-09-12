export const money=n=>Number.isFinite(n)?new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(n):'Chưa rõ giá';
export function assess(p,profile,orders=[]){
 if(!Number.isFinite(p.price)||p.price<=0)return {score:null,decision:'UNKNOWN',reasons:['Chưa xác định được giá của lựa chọn hiện tại. Hãy kiểm tra giá trước khi tiếp tục.']};
 let score=76;const reasons=[];const remaining=Math.max(0,profile.budget-profile.spent);
 if(p.price>remaining){score-=40;reasons.push(`Vượt ngân sách còn lại ${money(p.price-remaining)}.`);}
 else reasons.push(`Sau món này bạn còn ${money(remaining-p.price)} trong ngân sách.`);
 if(p.discount>=35){score-=15;reasons.push('Giảm giá sâu có thể tạo cảm giác gấp gáp; không chứng minh sản phẩm vô bổ.');}
 const similar=orders.filter(o=>o.category&&o.category===p.category);
 if(similar.length){score-=15;reasons.push(`Có ${similar.length} món cùng nhóm trong lịch sử; cần hỏi thêm, chưa kết luận trùng công dụng.`);}
 if(similar.some(o=>o.feedback==='regret')){score-=10;reasons.push('Bạn từng đánh dấu hối tiếc với một món cùng nhóm.');}
 return {score:Math.max(0,Math.min(100,score)),decision:score>=60?'ALLOW':'CHALLENGE',reasons};
}
export function advance(s,answer){
 if(s.phase==='confirm')return answer==='no'?{...s,phase:'cancelled'}:answer==='yes'?{...s,confirmations:s.confirmations+1,phase:s.confirmations>=2?'allowed':'confirm'}:s;
 if(s.phase==='question'&&answer.trim())return {...s,index:(s.index||0)+1,answers:[...(s.answers||[]),answer.trim()],phase:(s.index||0)>=2?'review':'question'};
 return s;
}
export const permitValid=(permit,key,now=Date.now())=>!!permit&&permit.key===key&&permit.until>now;
export function validateOrders(input){
 if(!Array.isArray(input)||input.length>2000)throw Error('Cần mảng JSON, tối đa 2.000 đơn.');
 return input.map((o,i)=>{if(!o||typeof o.name!=='string'||!o.name.trim()||!Number.isFinite(o.price)||o.price<=0||!/^\d{4}-\d{2}-\d{2}$/.test(o.date||'')||!Number.isFinite(Date.parse(o.date)))throw Error(`Đơn ${i+1}: cần name, price dương, date YYYY-MM-DD.`);return {id:crypto.randomUUID(),name:o.name.slice(0,200),price:o.price,date:o.date,category:String(o.category||'other').slice(0,50),feedback:['useful','regret'].includes(o.feedback)?o.feedback:''};});
}
