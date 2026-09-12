import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || new URL('../package.json', import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:4173');
await page.getByRole('heading',{name:'Mua ít hơn. Sống nhiều hơn.'}).waitFor();
await page.getByRole('button',{name:'Nạp dữ liệu mẫu'}).click();
await page.getByText('Đang dùng dữ liệu mẫu',{exact:true}).waitFor();
await page.screenshot({path:'docs/dashboard.png',fullPage:true});
await page.getByRole('button',{name:'✧ Thử trợ lý'}).click();
await page.getByLabel('Giá cuối (₫)').fill('5000000');
await page.getByRole('button',{name:'Đánh giá & thử bấm mua →'}).click();
// Closed shadow root is intentionally isolated; interact using visible text via accessibility snapshots
// Use keyboard focus that the modal assigns to its first textarea.
for(const answer of ['Tôi cần vệ sinh bàn làm việc mỗi ngày','Khăn hiện tại chưa hút được bụi trong kẽ bàn','Tôi sẽ dùng hai mươi lần mỗi tháng']){
 await page.keyboard.insertText(answer);await page.keyboard.press('Tab');await page.keyboard.press('Enter');
}
// Review: first button is save, second button is override.
await page.keyboard.press('Tab');await page.keyboard.press('Enter');
// assert visually through screenshot, and keyboard navigation for confirmation is checked below separately
await page.screenshot({path:'docs/guard-flow.png',fullPage:true});
for(let i=0;i<3;i++){
 await page.keyboard.press('Enter');
 const count=await page.evaluate(()=>JSON.parse(localStorage.getItem('guardian-v1')).events.filter(e=>e.type==='allowed').length);
 assert.equal(count,i===2?1:0,'only third confirmation authorizes');
}
await page.getByRole('button',{name:'☷ Hồ sơ & dữ liệu'}).click();
await page.getByLabel('Tên gọi').fill('Minh');
await page.getByRole('button',{name:'Lưu hồ sơ',exact:true}).click();
await page.getByText('Đã lưu hồ sơ.',{exact:true}).waitFor();
await page.reload();assert.equal(await page.getByLabel('Tên gọi').inputValue(),'Minh');
await page.setViewportSize({width:390,height:844});
await page.getByRole('button',{name:'◈ Tổng quan'}).click();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.screenshot({path:'docs/mobile.png',fullPage:true});
assert.deepEqual(errors,[]);
console.log('UI passed: sample data, guard keyboard flow, profile persistence, mobile overflow, no page errors.');
await browser.close();
