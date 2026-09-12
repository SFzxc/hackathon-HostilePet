import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopBridge} from '../extension/desktop-bridge.js';

class FakeWebSocket{
 static OPEN=1;
 static instances=[];
 constructor(url){this.url=url;this.readyState=FakeWebSocket.OPEN;this.sent=[];this.listeners=new Map();FakeWebSocket.instances.push(this);queueMicrotask(()=>this.emit('open',{}));}
 addEventListener(type,listener){const list=this.listeners.get(type)||[];list.push(listener);this.listeners.set(type,list);}
 emit(type,event){for(const listener of this.listeners.get(type)||[])listener(event);}
 send(frame){this.sent.push(JSON.parse(frame));}
 close(){this.readyState=3;this.emit('close',{});}
 receive(message){this.emit('message',{data:JSON.stringify(message)});}
}

test('handshakes, sends one recorder tick, and receives a desktop decision',async()=>{
 const decisions=[];
 const bridge=createDesktopBridge({WebSocketImpl:FakeWebSocket,reconnect:false,onDecision:message=>decisions.push(message)});
 bridge.start();await new Promise(resolve=>setImmediate(resolve));
 const socket=FakeWebSocket.instances.at(-1);
 assert.equal(socket.url,'ws://127.0.0.1:54321');
 assert.equal(socket.sent[0].type,'hello');
 assert.deepEqual(socket.sent[0].payload.sensors,[{packId:'browser',name:'session.tick',schema:'signal.session.tick@1'}]);

 socket.receive({protocolVersion:1,messageId:crypto.randomUUID(),timestamp:Date.now(),type:'welcome',payload:{protocolVersion:1,leaseDefaults:{minTtlMs:1000,defaultTtlMs:60000,maxTtlMs:300000},toneLocale:'vi',activeLeases:[]}});
 assert.equal(bridge.status(),'ready');
 assert.equal(bridge.sendRecorderEvent({timestamp:new Date().toISOString(),pageId:'page-1',site:'example.com',page:{url:'https://example.com/feed',siteType:'entertainment'},type:'attention_snapshot',data:{totalActiveMs:15000,interactionState:'active'}},12),true);
 const tick=socket.sent[1];
 assert.equal(tick.type,'signal.browser.session.tick');
 assert.deepEqual(tick.context,{tabId:12,documentId:'page-1',windowFocused:true});
 assert.equal(tick.payload.activeMs,15000);
 assert.equal(tick.payload.seq,1);

 const decision={protocolVersion:1,messageId:crypto.randomUUID(),timestamp:Date.now(),type:'intervention.request',context:{tabId:12,documentId:'page-1',windowFocused:true},payload:{lease:{leaseId:crypto.randomUUID()}}};
 socket.receive(decision);
 assert.deepEqual(decisions,[decision]);
 bridge.stop();
});
