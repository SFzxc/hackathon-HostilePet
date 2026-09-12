import test from 'node:test';
import assert from 'node:assert/strict';
const core = await import('../extension/recorder-core.js').catch(()=>({}));
test('checkout implies decision intent, never confirmed purchase',()=>{
 assert.equal(typeof core.inferIntent,'function');
 const r=core.inferIntent('checkout_click',{product:{name:'Tai nghe'}});
 assert.equal(r.stage,'purchase_imminent'); assert.equal(r.isInference,true); assert.ok(r.evidence.length); assert.notEqual(r.stage,'purchased');
});
test('unknown quantities are excluded from verified purchase units',()=>{
 const r=core.summarizeOrders([{orderId:'1',productId:'p',name:'Item',quantity:null,status:'completed'}]);
 assert.equal(r.completedUnits,0);assert.equal(r.unknownQuantityLines,1);
});
test('search and dwell do not assert purchase intent certainty',()=>{
 assert.equal(typeof core.inferIntent,'function');
 assert.equal(core.inferIntent('search_submitted',{query:'tai nghe'}).stage,'researching');
 assert.equal(core.inferIntent('product_dwell',{activeMs:15000}).stage,'considering');
 assert.equal(core.inferIntent('click',{}),null);
});
test('URL drops secrets and hash but preserves search context',()=>{
 assert.equal(typeof core.safeUrl,'function');
 assert.equal(core.safeUrl('https://shopee.vn/search?keyword=mouse&token=SECRET#private'),'https://shopee.vn/search?keyword=mouse');
});
test('category guesses declare unknown for unmatched products',()=>{
 assert.equal(typeof core.categoryOf,'function');
 assert.equal(core.categoryOf('Tai nghe Bluetooth').value,'electronics');
 assert.equal(core.categoryOf('XYZ').value,'unknown');
});
test('purchase summary deduplicates identical order lines but keeps distinct orders',()=>{
 assert.equal(typeof core.summarizeOrders,'function');
 const a={orderId:'1',productId:'3.4',name:'Tai nghe',quantity:2,status:'completed'};
 const r=core.summarizeOrders([a,a,{...a,orderId:'2'}, {...a,orderId:null}]);
 assert.equal(r.distinctOrders,2); assert.equal(r.completedUnits,4); assert.equal(r.unverifiedRows,1);
});
test('event retention caps both count and bytes and reports dropped records',()=>{
 assert.equal(typeof core.boundEvents,'function');
 const a={id:'1',data:'a'.repeat(50)},b={id:'2',data:'b'.repeat(50)};
 const r=core.boundEvents([a,b],2000,100);
 assert.deepEqual(r.events,[b]);assert.equal(r.dropped,1);
 assert.equal(core.boundEvents([a,b],1,1000).events[0].id,'2');
});
test('Vietnamese keyboards are electronics, not furniture',()=>assert.equal(core.categoryOf('Đang tìm bàn phím mới').value,'electronics'));

test('Shopee identity is derived from canonical and legacy product URLs',()=>{
 assert.deepEqual(core.parseShopeeIdentity('https://shopee.vn/product/123/456?x=1'),{shopId:'123',productId:'456'});
 assert.deepEqual(core.parseShopeeIdentity('https://shopee.vn/tai-nghe-i.987.654'),{shopId:'987',productId:'654'});
 assert.deepEqual(core.parseShopeeIdentity('https://shopee.vn/search?keyword=mouse'),{shopId:null,productId:null});
});

test('Vietnamese product prices and ranges retain unknowns instead of guessing',()=>{
 assert.equal(core.parseMoney('₫350.000'),350000);
 assert.equal(core.parseMoney('1,299,000 đ'),1299000);
 assert.equal(core.parseMoney('Liên hệ'),null);
 assert.deepEqual(core.parsePriceRange('₫120.000 - ₫180.000'),{min:120000,max:180000});
 assert.deepEqual(core.parsePriceRange('₫350.000'),{min:350000,max:350000});
 assert.deepEqual(core.parsePriceRange('Giá tùy chọn'),{min:null,max:null});
});

test('attention reducer separates focused, active and idle time without storing keys',()=>{
 let state=core.createAttentionState(0);
 state=core.reduceAttention(state,{now:1000,visible:true,focused:true,interacted:true,pointerMoves:2,pointerDistance:10,keydowns:1,idleThresholdMs:10000});
 state=core.reduceAttention(state,{now:6000,visible:true,focused:true,idleThresholdMs:10000});
 let view=core.attentionSnapshot(state,6000);
 assert.equal(view.continuousFocusMs,5000);
 assert.equal(view.totalFocusedMs,5000);
 assert.equal(view.totalActiveMs,5000);
 assert.equal(view.interactionState,'active');
 assert.deepEqual(view.interactions,{pointerMoves:2,pointerDistance:10,clicks:0,scrolls:0,keydowns:1});
 assert.equal('key' in view,false);
 state=core.reduceAttention(state,{now:12000,visible:true,focused:true,idleThresholdMs:10000});
 view=core.attentionSnapshot(state,12000);
 assert.equal(view.totalFocusedMs,11000);
 assert.equal(view.totalActiveMs,10000);
 assert.equal(view.interactionState,'idle');
 assert.equal(view.idleForMs,11000);
 state=core.reduceAttention(state,{now:13000,visible:true,focused:true,interacted:true,idleThresholdMs:10000});
 state=core.reduceAttention(state,{now:15000,visible:true,focused:false,idleThresholdMs:10000});
 view=core.attentionSnapshot(state,15000);
 assert.equal(view.totalFocusedMs,14000);
 assert.equal(view.totalActiveMs,12000);
 assert.equal(view.continuousFocusMs,0);
 assert.equal(view.continuousActiveMs,0);
});

test('website classifier labels common shopping, entertainment and work domains',()=>{
 assert.equal(core.classifyPage('https://shopee.vn/a','Tai nghe'),'shopping');
 assert.equal(core.classifyPage('https://www.youtube.com/watch?v=1','Video'),'entertainment');
 assert.equal(core.classifyPage('https://github.com/openai/example','Pull request'),'work');
 assert.equal(core.classifyPage('https://example.org/','Example'),'other');
});
