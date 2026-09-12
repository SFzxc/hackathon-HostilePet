// Capture is installed synchronously; companion starts automatically when the DOM is ready.
(()=>{
 let modules,pet,busy=false,productKey='',hoverTimer,refreshTimer,closeGuard,reviewGeneration=0;
 const approvals=new Map();
 const loading=Promise.all(['engine','store','guard','extractor','pet','approval'].map(n=>import(chrome.runtime.getURL(n+'.js')))).then(m=>modules=m);
 const buy=/^(mua ngay|mua hàng|đặt hàng|thanh toán|buy now|place order|checkout)$/i;
 const cart=/^(thêm vào giỏ hàng|thêm vào giỏ|add to cart)$/i;
 const candidate=(e,pattern)=>e.composedPath().find(n=>n instanceof Element&&n.matches('button,[role="button"],a')&&pattern.test(n.textContent.trim()));
 const own=e=>e.composedPath().some(n=>n.id==='guardian-pet');
 const say=(title,message,mood='watch',badge)=>pet?.say(title,message,mood,badge);
 const finish=()=>{reviewGeneration++;busy=false;closeGuard=null;pet?.setReviewEnabled(true);};
 const remembered=()=>say('Mình nhớ bạn đã đồng ý mua.','Cứ chọn mẫu, màu hoặc loại rồi bấm mua lại. Không cần trả lời lại trong phiên này.','watch','Đã ghi nhớ quyết định');
 function status(p){return modules[5].approvalStatus(approvals.get(modules[5].productIdentity(p)),p);}
 async function review(){
  if(busy)return;busy=true;const generation=++reviewGeneration;clearTimeout(hoverTimer);pet?.setReviewEnabled(false);
  try{const [engine,store,guard,extractor]=await loading;const p=extractor.extract();const data=await store.read();
   if(generation!==reviewGeneration)return;
   if(extractor.extract().key!==p.key){finish();refresh();return;}
   productKey=p.key;
   const approval=modules[5],previous=approvals.get(approval.productIdentity(p)),state=status(p),total=approval.purchaseTotal(p);
   if(state==='approved'){finish();remembered();return;}
   const changeOnly=state==='changed';
   const result=changeOnly?{decision:'ALLOW',reasons:[`Mức đã đồng ý: ${engine.money(previous.total)}. Lựa chọn hiện tại: ${engine.money(total)}${p.quantity>1?' cho '+p.quantity+' sản phẩm':''}.`,total===null||p.variant!==previous.variant&&!p.currentPriceVerified?'Chưa xác minh được giá của mẫu mới; hãy đối chiếu giá trên Shopee trước khi đồng ý.':'Bạn có muốn tiếp tục với mức này không?']}:engine.assess({...p,price:total},{...data.profile,spent:store.manualSpent(data.profile)+store.monthlySpent(data.orders)},data.orders);
   say(changeOnly?'Chỉ có lựa chọn thay đổi.':'Khoan một nhịp nhé.',changeOnly?'Mình nhớ lý do mua của bạn. Chỉ cần xác nhận mức tiền mới.':'Mình cùng kiểm tra nhu cầu trước khi mua.','guard','Đang bảo vệ');
   closeGuard=guard.openGuard(p,result,{tone:data.profile.tone,changeOnly,onAllow:async answers=>{
    finish();if(extractor.extract().key!==p.key){say('Lựa chọn vừa thay đổi.','Mình sẽ kiểm tra lại lựa chọn mới khi bạn bấm mua.','alert');return;}
    for(const [key,value] of approvals)if(value.until<=Date.now())approvals.delete(key);
    approvals.set(approval.productIdentity(p),approval.createApproval(p));remembered();
    try{const current=await store.read();current.events.push({type:'allowed',product:p,answers,at:Date.now()});await store.write(current);}catch{say('Đã mở khóa, chưa lưu được lịch sử.','Bạn có thể tiếp tục; dữ liệu quyết định này chưa được lưu.','alert');}
   },onSave:async answers=>{finish();try{const current=await store.read();current.saved.push({...p,id:crypto.randomUUID(),until:Date.now()+86400000});current.events.push({type:'saved',product:p,answers,at:Date.now()});await store.write(current);say('Để mai quyết định cũng được.','Mình đã để dành món này cho bạn.','watch','Đã để dành');}catch{say('Chưa lưu được món này.','Bạn chưa mua. Hãy thử lại sau.','alert');}},onCancel:()=>{finish();say('Cứ thong thả xem tiếp nhé.','Mình vẫn ở đây khi bạn cần cân nhắc.');}});
  }catch{if(generation===reviewGeneration){finish();say('Mình chưa đọc được trang.','Hãy tải lại trang để khởi động lại Guardian.','alert','Cần tải lại');}}
 }
 document.addEventListener('click',e=>{
  if(own(e))return;
  if(candidate(e,cart)){say('Thêm giỏ chưa cần mua ngay.','Bạn có thể để đó và quay lại khi nhu cầu rõ hơn.','alert','Đang cân nhắc');return;}
  if(!candidate(e,buy))return;
  if(modules&&status(modules[3].extract())==='approved'){clearTimeout(hoverTimer);remembered();return;}
  e.preventDefault();e.stopImmediatePropagation();review();
 },true);
 function anticipate(e){if(own(e)||busy||!candidate(e,buy)&&!candidate(e,cart))return;clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>{if(!busy){if(modules&&status(modules[3].extract())==='approved')remembered();else say('Bạn đang tính mua món này?','Mình sẽ cùng bạn kiểm tra nhu cầu và ngân sách trước khi chốt.','alert','Nhận thấy ý định mua');}},650);}
 document.addEventListener('pointerover',anticipate,true);document.addEventListener('focusin',anticipate,true);
 document.addEventListener('pointerout',e=>{if(candidate(e,buy)||candidate(e,cart))clearTimeout(hoverTimer);},true);
 document.addEventListener('focusout',()=>clearTimeout(hoverTimer),true);
 function refresh(){
  if(!modules||!pet||document.hidden)return;
  const p=modules[3].extract();if(p.key===productKey)return;
  productKey=p.key;
  if(busy){closeGuard?.();finish();}
  if(status(p)==='approved'){remembered();return;}
  if(status(p)==='changed'){say('Mình nhớ quyết định mua của bạn.','Giá hoặc số lượng đã đổi. Khi bấm mua, bạn chỉ cần xác nhận phần thay đổi.','alert','Lựa chọn thay đổi');return;}
  if(p.name==='Sản phẩm chưa xác định')say('Mình ở đây, cứ xem thoải mái.','Khi bạn chọn một món hoặc chuẩn bị mua, mình sẽ để ý.');
  else say('Mình đang xem cùng bạn.',`${p.name} · ${modules[0].money(p.price)}. ${p.price?'Khi bạn định mua, mình sẽ cùng cân nhắc.':'Mình chưa xác định được giá cuối, cần kiểm tra trước khi mua.'}`);
 }
 async function start(){try{const m=await loading;pet=m[4].mountPet({onReview:review});if(!pet)return;refresh();
   new MutationObserver(()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,300);}).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['content','aria-checked','aria-selected']});
   setInterval(refresh,1000);document.addEventListener('visibilitychange',refresh);
  }catch{console.warn('Guardian companion could not start. Reload the extension and page.');}}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
