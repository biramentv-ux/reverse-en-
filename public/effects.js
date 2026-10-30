const clamp=value=>Math.max(0,Math.min(1,Number(value)));
export function echoSeconds(bpm,beats){
  if(!Number.isFinite(bpm)||bpm<=0||!Number.isFinite(beats)||beats<=0)throw new Error('Echo needs a valid BPM and beat division.');
  const seconds=60/bpm*beats;if(seconds>8)throw new Error('Echo time exceeds eight seconds.');return seconds;
}
function impulse(context){
  const buffer=context.createBuffer(2,Math.ceil(context.sampleRate*1.2),context.sampleRate);
  let seed=85731;
  for(let ch=0;ch<2;ch++){const data=buffer.getChannelData(ch);for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;data[i]=seed/2147483648*Math.exp(-7*i/context.sampleRate);}}
  return buffer;
}
export class DeckEffects{
  constructor(context){this.context=context;this.input=context.createGain();this.output=context.createGain();this.echo=0;this.room=0;this.beats=.5;this.bpm=120;this.ir=impulse(context);this.nodes=[];this.clear();}
  clear(){
    this.input.disconnect();for(const node of this.nodes)node.disconnect();
    const c=this.context;
    this.dry=c.createGain();this.echoSend=c.createGain();this.delay=c.createDelay(8);this.echoWet=c.createGain();this.feedback=c.createGain();this.feedback.gain.value=.35;
    this.feedbackFilter=c.createBiquadFilter();this.feedbackFilter.type='lowpass';this.feedbackFilter.frequency.value=6000;
    this.roomSend=c.createGain();this.roomNode=c.createConvolver();this.roomNode.buffer=this.ir;this.roomWet=c.createGain();
    this.input.connect(this.dry);this.dry.connect(this.output);
    this.input.connect(this.echoSend);this.echoSend.connect(this.delay);this.delay.connect(this.echoWet);this.echoWet.connect(this.output);
    this.delay.connect(this.feedbackFilter);this.feedbackFilter.connect(this.feedback);this.feedback.connect(this.delay);
    this.input.connect(this.roomSend);this.roomSend.connect(this.roomNode);this.roomNode.connect(this.roomWet);this.roomWet.connect(this.output);
    this.nodes=[this.dry,this.echoSend,this.delay,this.echoWet,this.feedback,this.feedbackFilter,this.roomSend,this.roomNode,this.roomWet];
    this.delay.delayTime.value=echoSeconds(this.bpm,this.beats);this.applyAmounts(true);
  }
  applyAmounts(immediate=false){
    const now=this.context.currentTime;
    const set=(param,value)=>{if(immediate)param.value=value;else param.setTargetAtTime(value,now,.012);};
    set(this.dry.gain,1-.25*this.echo-.2*this.room);set(this.echoSend.gain,this.echo>0?1:0);set(this.echoWet.gain,.65*this.echo);
    set(this.roomSend.gain,this.room>0?1:0);set(this.roomWet.gain,.85*this.room);
  }
  setAmounts(echo,room){if(!Number.isFinite(Number(echo))||!Number.isFinite(Number(room)))throw new Error('Invalid effect amount.');this.echo=clamp(echo);this.room=clamp(room);this.applyAmounts();}
  setTiming(bpm,beats=this.beats,when=this.context.currentTime){const seconds=echoSeconds(bpm,beats);this.bpm=bpm;this.beats=beats;this.delay.delayTime.cancelScheduledValues(when);this.delay.delayTime.setTargetAtTime(seconds,when,.02);}
}
