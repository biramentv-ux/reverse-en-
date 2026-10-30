export function parseMidi(data){
  if(!data||data.length!==3||![...data].every(n=>Number.isInteger(n)&&n>=0&&n<=255))return null;
  const [status,a,b]=data,type=status&0xf0,channel=status&15;if(status<128||a>127||b>127)return null;
  if(type===0x90||type===0x80)return {type:'note',channel,number:a,raw:b,value:type===0x90&&b>0?1:0,pressed:type===0x90&&b>0};
  if(type===0xb0)return {type:'cc',channel,number:a,raw:b,value:b/127,pressed:b>=64};
  if(type===0xe0){const raw=a+(b<<7);return {type:'pitchbend',channel,number:0,raw,value:raw/16383};}
  return null;
}
export function relativeDelta(raw,mode){
  if(!Number.isInteger(raw)||raw<0||raw>127)throw new Error('Invalid relative MIDI value.');
  if(mode==='relative-twos')return raw<64?raw:raw-128;
  if(mode==='relative-offset')return raw-64;
  throw new Error('Choose a supported relative encoder mode.');
}
const clamp=value=>Math.max(0,Math.min(1,value));
const sourceKey=m=>JSON.stringify([m.deviceId,m.type,m.channel,m.number]);
export class MidiRouter{
  constructor(targets,{onMappings=()=>{},onResult=()=>{}}={}){this.targets=new Map(targets.map(t=>[t.id,t]));this.mappings=[];this.states=new Map();this.learning=null;this.onMappings=onMappings;this.onResult=onResult;}
  sanitize(mapping){
    if(!mapping||typeof mapping!=='object')throw new Error('Invalid MIDI mapping.');
    const target=this.targets.get(mapping.target);if(!target)throw new Error('Mapping contains an unknown target.');
    const {deviceId,type,channel,number}=mapping;
    if(typeof deviceId!=='string'||!deviceId||deviceId.length>256||!['note','cc','pitchbend'].includes(type)||!Number.isInteger(channel)||channel<0||channel>15||!Number.isInteger(number)||number<0||number>127||type==='pitchbend'&&number!==0)throw new Error('Mapping contains an invalid MIDI input.');
    const mode=mapping.mode||(target.kind==='button'?'button':'absolute');
    if(target.kind==='button'?(mode!=='button'||type==='pitchbend'):(type==='note'||!['absolute','relative-twos','relative-offset'].includes(mode)||mode!=='absolute'&&type!=='cc'))throw new Error('Mapping mode does not match the control type.');
    const step=mapping.step??.01;if(!Number.isFinite(step)||step<.001||step>.1)throw new Error('Encoder step must be between 0.1% and 10%.');
    return {deviceId,deviceName:typeof mapping.deviceName==='string'?mapping.deviceName.slice(0,160):deviceId,type,channel,number,target:target.id,mode,invert:!!mapping.invert,pickup:mapping.pickup!==false,step};
  }
  setMappings(mappings){
    if(!Array.isArray(mappings)||mappings.length>128)throw new Error('A MIDI mapping can contain at most 128 controls.');
    const cleaned=mappings.map(m=>this.sanitize(m)),keys=new Set();for(const mapping of cleaned){const key=sourceKey(mapping);if(keys.has(key))throw new Error('Two mappings use the same physical MIDI control.');keys.add(key);}
    this.mappings=cleaned;this.states.clear();this.learning=null;this.onMappings(this.mappings);return this.mappings;
  }
  importText(text,retarget=null){
    if(typeof text!=='string'||text.length>200000)throw new Error('Mapping JSON is too large.');
    let parsed;try{parsed=JSON.parse(text);}catch{throw new Error('Paste valid mapping JSON.');}
    if(parsed?.format!=='orbit-midi'||parsed.version!==1||!Array.isArray(parsed.mappings))throw new Error('This is not an ORBIT MIDI mapping version 1.');
    const mappings=retarget?parsed.mappings.map(m=>({...m,deviceId:retarget.id,deviceName:retarget.name})):parsed.mappings;return this.setMappings(mappings);
  }
  exportText(){return JSON.stringify({format:'orbit-midi',version:1,mappings:this.mappings},null,2);}
  learn(targetId,options={}){const target=this.targets.get(targetId);if(!target)throw new Error('Choose a valid MIDI target.');this.learning={targetId,options};return target;}
  cancelLearn(){this.learning=null;}
  remove(index){this.setMappings(this.mappings.filter((_,i)=>i!==index));}
  resetInput(deviceId){for(const m of this.mappings)if(m.deviceId===deviceId)this.states.delete(sourceKey(m));this.learning=null;}
  finish(result){this.onResult(result);return result;}
  handle(device,data){
    const message=parseMidi(data);if(!message||!device?.id)return {kind:'ignored'};
    const incoming={...message,deviceId:device.id,deviceName:device.name||device.id},key=sourceKey(incoming);
    if(this.learning){
      const target=this.targets.get(this.learning.targetId),options=this.learning.options;
      if(target.kind==='button'?(message.type==='pitchbend'||!message.pressed):message.type==='note')return this.finish({kind:'learn-wait',target:target.id});
      if(target.kind==='continuous'&&options.mode&&options.mode!=='absolute'&&message.type!=='cc')return this.finish({kind:'learn-wait',target:target.id});
      const mapping=this.sanitize({...incoming,...options,target:target.id,mode:target.kind==='button'?'button':options.mode||'absolute'});
      this.setMappings([...this.mappings.filter(m=>sourceKey(m)!==key),mapping]);
      if(mapping.mode==='button')this.states.set(key,{down:!!message.pressed});
      else if(mapping.mode==='absolute')this.states.set(key,{lastPhysical:mapping.invert?1-message.value:message.value,pickedUp:false});
      return this.finish({kind:'learned',mapping,target:target.id});
    }
    const mapping=this.mappings.find(m=>sourceKey(m)===key);if(!mapping)return {kind:'unmapped'};
    const target=this.targets.get(mapping.target),state=this.states.get(key)||{};this.states.set(key,state);
    if(mapping.mode==='button'){
      const down=!!message.pressed,previous=state.down;state.down=down;
      if(!down)return {kind:'release'};if(previous)return {kind:'held'};
      if(target.available&&!target.available())return this.finish({kind:'unavailable',target:target.id});
      target.run();return this.finish({kind:'applied',target:target.id});
    }
    if(target.available&&!target.available()){this.states.delete(key);return this.finish({kind:'unavailable',target:target.id});}
    const actual=clamp(Number(target.get()));if(!Number.isFinite(actual))return this.finish({kind:'unavailable',target:target.id});
    let value;
    if(mapping.mode==='absolute'){
      value=mapping.invert?1-message.value:message.value;
      const tolerance=message.type==='pitchbend'?2/16383:1.5/127;
      if(state.lastApplied!==undefined&&Math.abs(actual-state.lastApplied)>1e-6)state.pickedUp=false;
      if(mapping.pickup&&!state.pickedUp){
        const crossed=state.lastPhysical!==undefined&&(state.lastPhysical-actual)*(value-actual)<=0;
        state.lastPhysical=value;
        if(Math.abs(actual-value)>tolerance&&!crossed)return this.finish({kind:'pickup',target:target.id,value,software:actual});
      }
      state.pickedUp=true;state.lastPhysical=value;
    }else{
      const delta=relativeDelta(message.raw,mapping.mode)*(mapping.invert?-1:1);
      if(!delta)return {kind:'neutral'};
      if(state.lastApplied===undefined||Math.abs(actual-state.lastApplied)>1e-6)state.virtual=actual;
      value=clamp((state.virtual??actual)+delta*mapping.step);state.virtual=value;
    }
    target.set(clamp(value));state.lastApplied=clamp(Number(target.get()));return this.finish({kind:'applied',target:target.id,value:state.lastApplied});
  }
}
