import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMidi,relativeDelta,MidiRouter} from '../public/midi-router.js';
import {MidiConnection} from '../public/midi-connection.js';
const device={id:'controller-1',name:'Test controller'};
function rig(){let value=.5,actions=0,available=true;const targets=[{id:'play',kind:'button',available:()=>available,run:()=>actions++},{id:'volume',kind:'continuous',available:()=>available,get:()=>value,set:v=>value=Math.round(v*100)/100}];return {router:new MidiRouter(targets),get value(){return value;},get actions(){return actions;},external:v=>value=v,available:v=>available=v};}
const map=(target='volume',extra={})=>({deviceId:device.id,deviceName:device.name,type:'cc',channel:0,number:20,target,mode:target==='play'?'button':'absolute',...extra});
test('MIDI parser recognizes note release forms, channels and 14-bit pitch bend',()=>{
  assert.equal(parseMidi([0x9f,60,100]).channel,15);assert.equal(parseMidi([0x90,60,0]).pressed,false);assert.equal(parseMidi([0x80,60,64]).pressed,false);
  assert.equal(parseMidi([0xe0,127,127]).value,1);assert.equal(parseMidi([0xe0,0,64]).raw,8192);assert.equal(parseMidi([0xb2,21,127]).value,1);
});
test('MIDI parser ignores SysEx, clocks, incomplete messages and invalid data',()=>{
  for(const data of [[0xf8],[0xf0,1,0xf7],[0xc0,20],[0x90,60],[0x90,200,10],[0xb0,2,-1],[0x90,1,1,2],[0x70,1,2],[0xb0,2,1.5]])assert.equal(parseMidi(data),null);
});
test('Learn captures a button without performing it, and requires release before next press',()=>{
  const r=rig();r.router.learn('play');assert.equal(r.router.handle(device,[0x90,60,127]).kind,'learned');assert.equal(r.actions,0);
  assert.equal(r.router.handle(device,[0x90,60,100]).kind,'held');r.router.handle(device,[0x90,60,0]);r.router.handle(device,[0x90,60,100]);assert.equal(r.actions,1);r.router.handle(device,[0x80,60,0]);r.router.handle(device,[0x90,60,100]);assert.equal(r.actions,2);
});
test('CC button triggers only on a rising press edge',()=>{
  const r=rig();r.router.setMappings([map('play')]);for(const v of [0,63,64,127,127,0,127])r.router.handle(device,[0xb0,20,v]);assert.equal(r.actions,2);
});
test('Absolute soft takeover waits for crossing and re-arms after mouse changes',()=>{
  const r=rig();r.router.setMappings([map()]);assert.equal(r.router.handle(device,[0xb0,20,0]).kind,'pickup');assert.equal(r.value,.5);
  r.router.handle(device,[0xb0,20,80]);assert.equal(r.value,.63);r.external(.9);assert.equal(r.router.handle(device,[0xb0,20,85]).kind,'pickup');assert.equal(r.value,.9);
  r.router.handle(device,[0xb0,20,120]);assert.equal(r.value,.94);
});
test('Learned absolute fader remembers its capture position for pickup crossing',()=>{
  const r=rig();r.router.learn('volume',{pickup:true});r.router.handle(device,[0xb0,20,10]);assert.equal(r.value,.5);r.router.handle(device,[0xb0,20,100]);assert.equal(r.value,.79);
});
test('Absolute inversion and disabled pickup apply the expected endpoints',()=>{
  const r=rig();r.router.setMappings([map('volume',{invert:true,pickup:false})]);r.router.handle(device,[0xb0,20,0]);assert.equal(r.value,1);r.router.handle(device,[0xb0,20,127]);assert.equal(r.value,0);
});
test('Relative encoders support both signed conventions and accumulate below UI step',()=>{
  assert.equal(relativeDelta(127,'relative-twos'),-1);assert.equal(relativeDelta(1,'relative-twos'),1);assert.equal(relativeDelta(64,'relative-offset'),0);assert.equal(relativeDelta(63,'relative-offset'),-1);
  const r=rig();r.router.setMappings([map('volume',{mode:'relative-twos',step:.001})]);for(let i=0;i<10;i++)r.router.handle(device,[0xb0,20,1]);assert.equal(r.value,.51);
  r.external(.2);r.router.handle(device,[0xb0,20,127]);assert.equal(r.value,.2);for(let i=0;i<9;i++)r.router.handle(device,[0xb0,20,127]);assert.equal(r.value,.19);
});
test('14-bit pitch bend can map an absolute control but not a relative encoder',()=>{
  const r=rig();r.router.setMappings([map('volume',{type:'pitchbend',number:0,pickup:false})]);r.router.handle(device,[0xe0,127,127]);assert.equal(r.value,1);r.router.handle(device,[0xe0,0,0]);assert.equal(r.value,0);
  assert.throws(()=>r.router.setMappings([map('volume',{type:'pitchbend',number:0,mode:'relative-twos'})]));
});
test('Mappings isolate device and channel and reset safely after unavailable controls',()=>{
  const r=rig();r.router.setMappings([map('volume',{pickup:false})]);r.router.handle({id:'another'},[0xb0,20,127]);r.router.handle(device,[0xb1,20,127]);assert.equal(r.value,.5);
  r.router.setMappings([map()]);r.router.handle(device,[0xb0,20,64]);r.available(false);r.router.handle(device,[0xb0,20,127]);r.available(true);r.router.handle(device,[0xb0,20,127]);assert.equal(r.value,.5);
  r.router.resetInput(device.id);assert.equal(r.router.handle(device,[0xb0,20,0]).kind,'pickup');
});
test('Mapping import is atomic, bounded and rejects unknown or conflicting targets',()=>{
  const r=rig();r.router.setMappings([map()]);const original=r.router.exportText();
  for(const bad of [{format:'other',version:1,mappings:[]},{format:'orbit-midi',version:1,mappings:[map('missing')]},{format:'orbit-midi',version:1,mappings:[map(),map()]}]){assert.throws(()=>r.router.importText(JSON.stringify(bad)));assert.equal(r.router.exportText(),original);}
  assert.throws(()=>r.router.setMappings(Array(129).fill(map())));assert.throws(()=>r.router.importText('x'.repeat(200001)));
  const copy=rig();copy.router.importText(original,{id:'new-controller',name:'New'});assert.equal(copy.router.mappings[0].deviceId,'new-controller');
});
function fakePort(id,access){return {id,name:id,manufacturer:'Test',state:'connected',onmidimessage:null,opens:0,closes:0,async open(){this.opens++;access.onstatechange?.({port:this});},async close(){this.closes++;access.onstatechange?.({port:this});}};}
test('MIDI connection requests no SysEx/software and subscribes only to the chosen input',async()=>{
  const access={inputs:new Map(),onstatechange:null},a=fakePort('a',access),b=fakePort('b',access);access.inputs.set('a',a);access.inputs.set('b',b);let options,messages=0;
  const c=new MidiConnection({requestAccess:async o=>{options=o;return access;},onMessage:()=>messages++});await c.connect();assert.deepEqual(options,{sysex:false,software:false});assert.equal(c.port,null);
  await c.select('a');a.onmidimessage({data:new Uint8Array([0xb0,20,1])});assert.equal(messages,1);assert.equal(b.onmidimessage,null);assert.equal(a.opens,1);
  await c.select('b');assert.equal(a.onmidimessage,null);assert.equal(a.closes,1);assert.equal(b.opens,1);await c.disconnect();assert.equal(b.onmidimessage,null);assert.equal(access.onstatechange,null);assert.equal(b.closes,1);
});
test('A single input opens once despite statechange during opening and closing',async()=>{
  const access={inputs:new Map(),onstatechange:null},port=fakePort('only',access);access.inputs.set('only',port);const c=new MidiConnection({requestAccess:async()=>access});await c.connect();assert.equal(c.port,port);assert.equal(port.opens,1);await c.disconnect();assert.equal(port.opens,1);
});
test('Disconnect cancels a pending permission request without attaching handlers later',async()=>{
  let resolve;const access={inputs:new Map(),onstatechange:null},c=new MidiConnection({requestAccess:()=>new Promise(r=>resolve=r)});const pending=c.connect();await c.disconnect();resolve(access);await pending;assert.equal(c.access,null);assert.equal(access.onstatechange,null);assert.equal(c.pending,false);
});
test('Permission denial leaves a retryable disconnected state',async()=>{
  const c=new MidiConnection({requestAccess:async()=>{throw new Error('permission denied');}});await assert.rejects(()=>c.connect(),/permission denied/);assert.equal(c.pending,false);assert.equal(c.access,null);
});
test('Unplug removes the input handler and reconnect restores only the selected port',async()=>{
  const access={inputs:new Map(),onstatechange:null},port=fakePort('only',access);access.inputs.set('only',port);const reset=[];const c=new MidiConnection({requestAccess:async()=>access,onReset:id=>reset.push(id)});await c.connect();port.state='disconnected';access.onstatechange({port});assert.equal(port.onmidimessage,null);assert.deepEqual(reset,['only']);
  port.state='connected';access.onstatechange({port});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(c.port,port);assert.equal(port.opens,2);await c.disconnect();
});
