export function sampleRegion(bufferDuration,start,duration){
  if(![bufferDuration,start,duration].every(Number.isFinite)||bufferDuration<=0||start<0||start>=bufferDuration||duration<.05||duration>30)throw new Error('Choose a start inside the track and a sample length from 0.05 to 30 seconds.');
  const length=Math.min(duration,bufferDuration-start);if(length<.05-1e-9)throw new Error('At least 0.05 seconds must remain after the sample start.');return {start,duration:length};
}
export class Sampler{
  constructor(engine){
    this.engine=engine;this.context=engine.ctx;const c=this.context;
    this.level=c.createGain();this.level.gain.value=.6;this.masterSend=c.createGain();this.cueSend=c.createGain();this.cueSend.gain.value=0;
    this.level.connect(this.masterSend);this.masterSend.connect(engine.master);this.level.connect(this.cueSend);this.cueSend.connect(engine.cueBus);
    this.route='master';this.slots=Array.from({length:4},()=>({buffer:null,name:'Empty pad',voice:null,voices:new Set()}));
  }
  setVolume(value){if(!Number.isFinite(value)||value<0||value>1)throw new Error('Invalid sampler volume.');this.level.gain.setTargetAtTime(value,this.context.currentTime,.012);}
  setRoute(route){if(!['master','headphones'].includes(route))throw new Error('Invalid sampler route.');this.route=route;this.masterSend.gain.setTargetAtTime(route==='master'?1:0,this.context.currentTime,.012);this.cueSend.gain.setTargetAtTime(route==='headphones'?1:0,this.context.currentTime,.012);}
  assign(index,buffer,{start=0,duration=Math.min(30,buffer.duration),name='Sample'}={}){
    const slot=this.slots[index];if(!slot)throw new Error('Unknown sampler pad.');const region=sampleRegion(buffer.duration,start,duration);
    const offset=Math.round(region.start*buffer.sampleRate),length=Math.max(1,Math.min(buffer.length-offset,Math.round(region.duration*buffer.sampleRate)));
    const sample=this.context.createBuffer(buffer.numberOfChannels,length,buffer.sampleRate);
    for(let ch=0;ch<buffer.numberOfChannels;ch++)sample.copyToChannel(buffer.getChannelData(ch).subarray(offset,offset+length),ch);
    this.stop(index);slot.buffer=sample;slot.name=name;slot.region={start:offset/buffer.sampleRate,duration:length/buffer.sampleRate};return slot.region;
  }
  clear(index){this.stop(index);const slot=this.slots[index];slot.buffer=null;slot.name='Empty pad';slot.region=null;}
  trigger(index,when=this.context.currentTime){
    const slot=this.slots[index];if(!slot?.buffer)throw new Error('Load a sample into this pad first.');this.stop(index);
    const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=slot.buffer;source.connect(gain);gain.connect(this.level);
    when=Math.max(when,this.context.currentTime);const end=when+slot.buffer.duration,fade=Math.min(.006,slot.buffer.duration/4);
    gain.gain.value=0;gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(1,when+fade);gain.gain.setValueAtTime(1,end-fade);gain.gain.linearRampToValueAtTime(0,end);
    const voice={source,gain,when,end};slot.voice=voice;slot.voices.add(voice);
    source.onended=()=>{source.disconnect();gain.disconnect();slot.voices.delete(voice);if(slot.voice===voice)slot.voice=null;};source.start(when);return voice;
  }
  stop(index){const slot=this.slots[index];if(!slot)return;const now=this.context.currentTime;for(const voice of slot.voices){voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setValueAtTime(voice.gain.gain.value,now);voice.gain.gain.linearRampToValueAtTime(0,now+.006);voice.source.stop(now+.008);}slot.voice=null;}
  stopAll(){this.slots.forEach((_,i)=>this.stop(i));}
}
