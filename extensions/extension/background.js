chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('index.html')}));
import {storageKey,fresh,mergeChanges} from './store.js';
let queue=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message.type!=='guardian-write'||sender.id!==chrome.runtime.id)return;
 queue=queue.then(async()=>{try{const current=(await chrome.storage.local.get(storageKey))[storageKey]||fresh();const data=message.reset?message.next:mergeChanges(current,message.base,message.next);await chrome.storage.local.set({[storageKey]:data});respond({data});}catch{respond({error:'Không lưu được dữ liệu.'});}});
 return true;
});
