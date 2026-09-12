import {mountPet} from './pet.js';
import {openGuard} from './guard.js';
import {assess} from './engine.js';
import {approvalStatus,createApproval} from './approval.js';
const product={url:'https://guardian-demo.invalid/product/vacuum',name:'Máy hút bụi mini cho góc làm việc',price:479000,category:'gadgets',discount:45};
let busy=false,approval=null,hoverTimer;
const result=document.querySelector('#result');
const pet=mountPet({demo:true,onReview:review});
pet.say('Mình đang xem cùng bạn.','Máy hút bụi mini · 479.000 ₫. Cứ xem thoải mái, mình sẽ để ý khi bạn định mua.');
function review(){if(busy)return;busy=true;pet.setReviewEnabled(false);pet.say('Khoan một nhịp nhé.','Món này vượt ngân sách minh họa. Mình cùng xem nhu cầu trước.','guard','Đang bảo vệ');
const finish=()=>{busy=false;pet.setReviewEnabled(true);};
openGuard(product,assess(product,{budget:300000,spent:0},[]),{onAllow:()=>{finish();approval=createApproval(product);pet.say('Mình nhớ bạn đã đồng ý mua.','Bạn có thể chọn mẫu rồi bấm mua lại, không cần trả lời lại trong 20 phút.','watch','Đã ghi nhớ quyết định');},onSave:()=>{finish();pet.say('Để mai quyết định cũng được.','Trong extension thật, món này sẽ được lưu để xem lại.','watch','Đã dừng lại');result.textContent='Mô phỏng: chọn để dành, không ghi vào hồ sơ.';},onCancel:()=>{finish();pet.say('Cứ thong thả xem tiếp nhé.','Không mua vội cũng là một lựa chọn.');}});}
document.querySelector('#buy').onclick=()=>{clearTimeout(hoverTimer);if(approvalStatus(approval,product)==='approved'){result.textContent='Mô phỏng hoàn tất: quyết định đã được ghi nhớ. Không có đơn hàng thật.';pet.say('Mình nhớ bạn đã đồng ý mua.','Bạn được tiếp tục, không cần trả lời lại. Đây chỉ là mô phỏng.');}else review();};
document.querySelector('#cart').onclick=()=>{clearTimeout(hoverTimer);pet.say('Thêm giỏ chưa cần mua ngay.','Bạn có thể để đó, mai quay lại nếu vẫn cần.','alert','Đang cân nhắc');result.textContent='Mô phỏng thêm giỏ — không thay đổi giỏ hàng thật.';};
for(const b of document.querySelectorAll('.buttons button')){const anticipate=()=>{clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>{if(!busy)pet.say('Bạn đang tính mua món này?','Mình sẽ cùng bạn kiểm tra nhu cầu và ngân sách trước khi chốt.','alert','Nhận thấy ý định mua');},650);};b.onpointerenter=anticipate;b.onfocus=anticipate;b.onpointerleave=()=>clearTimeout(hoverTimer);b.onblur=()=>clearTimeout(hoverTimer);}
