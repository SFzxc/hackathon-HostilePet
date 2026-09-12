import {createRequire} from 'node:module';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || new URL('../package.json', import.meta.url));const {chromium}=require('playwright');
const extension=path.resolve('extension');const context=await chromium.launchPersistentContext(path.resolve('.test-browser'),{channel:'msedge',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
context.setDefaultTimeout(7000);
const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).hostname;
const dashboard=await context.newPage();await dashboard.goto(`chrome-extension://${id}/index.html#profile`);await dashboard.evaluate(async()=>{await chrome.storage.local.clear();});await dashboard.reload();await dashboard.getByLabel('Tên gọi').fill('Extension Test');await dashboard.getByRole('button',{name:'Lưu hồ sơ',exact:true}).click();await dashboard.getByText('Đã lưu hồ sơ.',{exact:true}).waitFor();
const page=await context.newPage();await page.route('https://shopee.vn/guardian-test',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><script type="application/ld+json">{"@type":"Product","name":"Fixture product","offers":{"price":5000000}}</script></head><body><h1>Fixture product</h1><button id="variant">Chọn màu xanh</button><button id="buy">Mua ngay</button><p id="validation"></p><script>window.buys=0;window.attempts=0;window.selected=false;document.querySelector('#variant').onclick=()=>{window.selected=true;history.replaceState({},'','?variant=blue');};document.querySelector('#buy').onclick=()=>{window.attempts++;if(!window.selected){document.querySelector('#validation').textContent='Vui lòng chọn phân loại';return;}window.buys++;};</script></body></html>`}));
await page.goto('https://shopee.vn/guardian-test');
await page.locator('#guardian-pet').waitFor({timeout:4000});
assert.match(await page.locator('#guardian-pet .label').innerText(),/GUARDIAN/);
await page.getByRole('button',{name:'Mua ngay'}).hover();
await page.getByText('Bạn đang tính mua món này?').waitFor({timeout:4000});
assert.equal(await page.evaluate(()=>window.buys),0,'hover never purchases');
await page.screenshot({path:'docs/pet-shopee.png'});
await page.getByRole('button',{name:'Mua ngay'}).click();assert.equal(await page.evaluate(()=>window.buys),0);
// Wait for asynchronous extension imports and focus in its isolated-world dialog.
await page.waitForFunction(()=>document.activeElement?.tagName==='DIV');
for(const a of ['Tôi cần món này cho công việc','Đồ cũ hỏng không thể sửa được','Sử dụng mỗi ngày trong tháng']){await page.keyboard.insertText(a);await page.keyboard.press('Tab');await page.keyboard.press('Enter');}
await page.keyboard.press('Tab');await page.keyboard.press('Enter');
for(let i=0;i<3;i++){await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.buys),0);}
await page.getByRole('button',{name:'Mua ngay'}).click();
await page.getByText('Vui lòng chọn phân loại',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.buys),0,'Shopee validation fails but approval remains');
await page.getByRole('button',{name:'Chọn màu xanh'}).click();
await page.getByRole('button',{name:'Mua ngay'}).click();assert.equal(await page.evaluate(()=>window.buys),1,'choosing variant does not restart questions');
await page.getByRole('button',{name:'Mua ngay'}).click();assert.equal(await page.evaluate(()=>window.buys),2,'retry remains approved');
// Stale dashboard must not erase content-script event when saving profile.
await dashboard.getByLabel('Tên gọi').fill('Changed name');await dashboard.getByRole('button',{name:'Lưu hồ sơ',exact:true}).click();
await dashboard.waitForFunction(async()=>{const r=await chrome.storage.local.get('guardian-v1');return r['guardian-v1'].profile.name==='Changed name';});
assert.equal(await dashboard.evaluate(async()=>{const r=await chrome.storage.local.get('guardian-v1');return r['guardian-v1'].events.filter(e=>e.type==='allowed').length;}),1);
// A higher-priced variant asks only for the difference, not the needs interview.
await page.evaluate(()=>{document.querySelector('script[type="application/ld+json"]').textContent=JSON.stringify({'@type':'Product',name:'Fixture product',offers:{price:6000000}});});
await page.getByRole('button',{name:'Mua ngay'}).click();
assert.equal(await page.evaluate(()=>window.buys),2);
await page.waitForFunction(()=>document.activeElement?.tagName==='DIV');
await page.keyboard.press('Enter');
await page.getByRole('button',{name:'Mua ngay'}).click();assert.equal(await page.evaluate(()=>window.buys),3,'single confirmation accepts changed total');
// SPA changes replace the companion context and do not approve a different item.
await page.getByRole('button',{name:'Mua ngay'}).click();
await page.evaluate(()=>{history.pushState({},'', '/guardian-other');document.querySelector('script[type="application/ld+json"]').textContent=JSON.stringify({'@type':'Product',name:'New SPA product',offers:{price:7000000}});document.querySelector('h1').textContent='New SPA product';});
await page.locator('#guardian-pet .message').filter({hasText:'New SPA product'}).waitFor();
assert.equal(await page.locator('#guardian-pet').count(),1);
await page.getByRole('button',{name:'Mua ngay'}).click();
assert.equal(await page.evaluate(()=>window.buys),4,'new product is guarded');
await page.keyboard.press('Escape');
console.log('Extension passed: MV3, missing-variant retry retains approval, query changes, repeated clicks, price-change-only confirmation, new item guarded, cross-tab persistence. Synthetic Shopee fixture only.');
}finally{await context.close();}
