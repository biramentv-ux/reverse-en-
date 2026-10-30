import {AudioEngine} from './engine.js';
const sr=48000,assert=(value,message)=>{if(!value)throw new Error(message);};
function setup(seconds=2){const c=new OfflineAudioContext(2,Math.ceil(seconds*sr),sr),e=new AudioEngine();e.buildGraph(c);return {c,e};}
function tone(c,hz=440,seconds=.8){const buffer=c.createBuffer(1,Math.ceil(seconds*sr),sr),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=.2*Math.sin(2*Math.PI*hz*i/sr);return buffer;}
function pulse(c){const buffer=c.createBuffer(1,sr*.1,sr),data=buffer.getChannelData(0);for(let i=sr*.02;i<sr*.021;i++)data[i]=.5;return buffer;}
function rms(data,from,to){let n=0,sum=0;for(let i=Math.floor(from*sr);i<Math.min(data.length,to*sr);i++){sum+=data[i]**2;n++;}return Math.sqrt(sum/n);}
function magnitude(data,hz,from=.2,to=.5){let re=0,im=0,n=0;for(let i=Math.ceil(from*sr);i<Math.min(data.length,to*sr);i++){re+=data[i]*Math.cos(2*Math.PI*hz*i/sr);im+=data[i]*Math.sin(2*Math.PI*hz*i/sr);n++;}return 2*Math.hypot(re,im)/n;}
export const performanceChecks=[
  ['FX at zero is a sample-identical dry path',async()=>{
    const {c,e}=setup(),d=e.decks[0];e.stereoGate.gain.cancelScheduledValues(0);e.stereoGate.gain.value=0;d.load(tone(c));d.play();const probe=c.createChannelMerger(2);d.filter.connect(probe,0,0);d.fx.output.connect(probe,0,1);probe.connect(c.destination);
    const out=await c.startRendering(),left=out.getChannelData(0),right=out.getChannelData(1);let error=0;for(let i=0;i<left.length;i++)error=Math.max(error,Math.abs(left[i]-right[i]));assert(error<1e-9,'Zero FX changed the dry signal');return {maxSampleDifference:error};
  }],
  ['Echo arrives on the selected beat division after a tempo change',async()=>{
    const {c,e}=setup(),d=e.decks[0];d.load(pulse(c));d.setBpm(120);d.fx.setAmounts(1,0);d.setRate(1.16);d.play(.1);
    const out=await c.startRendering(),data=out.getChannelData(0),expected=.1+.02/1.16+60/(120*1.16)*.5+.006;
    let peak=0,index=0;for(let i=Math.floor((expected-.005)*sr);i<(expected+.005)*sr;i++)if(Math.abs(data[i])>peak){peak=Math.abs(data[i]);index=i;}
    assert(peak>.02,'Tempo echo was silent');assert(Math.abs(index/sr-expected)<.002,'Echo missed the beat division');return {expectedSeconds:expected,measuredPeak:index/sr,peakAmplitude:peak};
  }],
  ['Channel volume mutes echo tails on master while PFL still hears them',async()=>{
    const {c,e}=setup(),d=e.decks[0];e.setOutputMode('split');d.load(pulse(c));d.level.gain.value=0;d.setCue(true);d.fx.setAmounts(1,0);d.play(.1);const out=await c.startRendering(),cue=rms(out.getChannelData(0),.35,.45),master=rms(out.getChannelData(1),.35,.45);assert(cue>.001&&master<1e-7,'FX did not follow the channel/PFL routing');return {cueTailRms:cue,masterTailRms:master};
  }],
  ['Crossfader endpoint also excludes the opposite deck effect tails',async()=>{
    const {c,e}=setup(),d=e.decks[0];e.setCrossfade(1);d.load(pulse(c));d.fx.setAmounts(1,1);d.play(.1);const out=await c.startRendering(),level=rms(out.getChannelData(0),.3,1);assert(level<1e-7,'Effects leaked across the crossfader endpoint');return {excludedFxRms:level};
  }],
  ['Room effect creates a finite decay after the source ends',async()=>{
    const {c,e}=setup(2),d=e.decks[0];d.load(pulse(c));d.fx.setAmounts(0,1);d.play(.1);const out=await c.startRendering(),data=out.getChannelData(0),tail=rms(data,.3,.7),end=rms(data,1.6,1.9);assert(tail>1e-5&&end<1e-7,'Room tail is missing or does not decay');assert(data.every(Number.isFinite),'Non-finite effect samples');return {roomTailRms:tail,lateRms:end};
  }],
  ['Loading another track clears the previous effects memory',async()=>{
    const {c,e}=setup(2),d=e.decks[0];d.load(pulse(c));d.fx.setAmounts(1,1);d.play();const suspended=c.suspend(.2),rendering=c.startRendering();await suspended;d.load(c.createBuffer(1,sr*.1,sr));d.play(.25);await c.resume();const out=await rendering,level=rms(out.getChannelData(0),.3,1.8);assert(level<1e-7,'Old effect tail survived track replacement');return {oldTailAfterLoadRms:level};
  }],
  ['Sampler plays the selected trim and stops at its natural end',async()=>{
    const {c,e}=setup(1.4),buffer=tone(c,330,2),data=buffer.getChannelData(0);for(let i=sr;i<data.length;i++)data[i]=.2*Math.sin(2*Math.PI*660*i/sr);
    const region=e.sampler.assign(0,buffer,{start:1.1,duration:.4,name:'Trim test'});e.sampler.trigger(0,.1);const out=await c.startRendering(),audio=out.getChannelData(0),chosen=magnitude(audio,660,.2,.4),unselected=magnitude(audio,330,.2,.4),tail=rms(audio,.7,1.2);assert(chosen>.02&&unselected<chosen*.01&&tail<1e-7,'Sampler trim or ending was incorrect');return {region,selected660Hz:chosen,unselected330Hz:unselected,tailRms:tail};
  }],
  ['Four sampler pads play together and one can stop independently',async()=>{
    const {c,e}=setup(1.4),frequencies=[220,330,440,550];frequencies.forEach((hz,i)=>{e.sampler.assign(i,tone(c,hz,1));e.sampler.trigger(i,.1);});const suspended=c.suspend(.4),rendering=c.startRendering();await suspended;e.sampler.stop(1);await c.resume();const out=await rendering,data=out.getChannelData(0),before=frequencies.map(hz=>magnitude(data,hz,.2,.35)),after=frequencies.map(hz=>magnitude(data,hz,.6,.8));assert(before.every(v=>v>.02),'A sampler pad was missing');assert(after[1]<.001&&after.filter((_,i)=>i!==1).every(v=>v>.02),'Stopping a pad affected other samples');return {before,after};
  }],
  ['Sampler master output is independent of deck faders and crossfader',async()=>{
    const {c,e}=setup();e.decks.forEach(d=>d.level.gain.value=0);e.setCrossfade(1);e.sampler.assign(0,tone(c,660));e.sampler.trigger(0,.1);const out=await c.startRendering(),value=magnitude(out.getChannelData(0),660);assert(value>.02,'Sampler was muted by deck controls');return {sampler660Hz:value};
  }],
  ['Headphone-only sampler stays off master even with master volume zero',async()=>{
    const {c,e}=setup();e.setOutputMode('split');e.setMaster(0);e.sampler.setRoute('headphones');e.sampler.assign(0,tone(c));e.sampler.trigger(0,.1);const out=await c.startRendering(),cue=rms(out.getChannelData(0),.2,.5),master=rms(out.getChannelData(1),.2,.5);assert(cue>.02&&master<1e-7,'Sampler headphone/master routing failed');return {cueRms:cue,masterRms:master};
  }],
  ['Sampler retrigger replaces the old voice and Stop samples silences all pads',async()=>{
    const {c,e}=setup(1.6);e.sampler.assign(0,tone(c,440,1));e.sampler.trigger(0,.1);const first=c.suspend(.4),rendering=c.startRendering();await first;e.sampler.trigger(0);const second=c.suspend(.9);await c.resume();await second;e.sampler.stopAll();await c.resume();const out=await rendering,data=out.getChannelData(0),before=magnitude(data,440,.2,.35),after=magnitude(data,440,.6,.8),tail=rms(data,1.1,1.4);assert(Math.abs(after-before)<before*.02&&tail<1e-7,'Retrigger doubled the voice or Stop samples left audio');return {before,after,afterStopRms:tail};
  }],
  ['Recording includes channel FX and excludes headphone sampler',async()=>{
    const e=new AudioEngine();e.buildGraph(new AudioContext({sampleRate:sr}));for(const gate of [e.stereoGate,e.splitGate]){gate.gain.cancelScheduledValues(0);gate.gain.value=0;}
    try{
      e.decks[0].load(tone(e.ctx,880,2));e.decks[0].fx.setAmounts(.5,.5);e.setCrossfade(0);e.sampler.assign(0,tone(e.ctx,440,2));e.sampler.setRoute('headphones');await e.ctx.resume();
      const mime=['audio/webm;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));assert(mime,'No recording codec');const recorder=new MediaRecorder(e.recordBus.stream,{mimeType:mime}),chunks=[];
      const done=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>chunks.push(event.data);recorder.onstop=resolve;recorder.onerror=()=>reject(new Error('Recording failed'));});recorder.start();e.decks[0].play();e.sampler.trigger(0);await new Promise(resolve=>setTimeout(resolve,1100));recorder.stop();await done;
      const blob=new Blob(chunks,{type:mime}),decoded=await e.ctx.decodeAudioData(await blob.arrayBuffer()),data=decoded.getChannelData(0),master=magnitude(data,880,.3,.8),cue=magnitude(data,440,.3,.8);assert(master>.03&&cue<master*.01,'FX master was missing or headphone sampler leaked');
      e.decks[0].seek(0);e.sampler.setRoute('master');e.sampler.trigger(0);const masterChunks=[],masterRecorder=new MediaRecorder(e.recordBus.stream,{mimeType:mime});
      const masterDone=new Promise((resolve,reject)=>{masterRecorder.ondataavailable=event=>masterChunks.push(event.data);masterRecorder.onstop=resolve;masterRecorder.onerror=()=>reject(new Error('Sampler master recording failed'));});masterRecorder.start();await new Promise(resolve=>setTimeout(resolve,800));masterRecorder.stop();await masterDone;
      const masterBlob=new Blob(masterChunks,{type:mime}),masterDecoded=await e.ctx.decodeAudioData(await masterBlob.arrayBuffer()),masterData=masterDecoded.getChannelData(0),recordedSampler=magnitude(masterData,440,.2,.6),recordedDeck=magnitude(masterData,880,.2,.6);
      assert(recordedSampler>.03&&recordedDeck>.03,'Master sampler or FX deck was missing from recording');
      e.sampler.stopAll();e.decks[0].pause();const tailChunks=[],tailRecorder=new MediaRecorder(e.recordBus.stream,{mimeType:mime});const tailDone=new Promise((resolve,reject)=>{tailRecorder.ondataavailable=event=>tailChunks.push(event.data);tailRecorder.onstop=resolve;tailRecorder.onerror=()=>reject(new Error('FX tail recording failed'));});tailRecorder.start();await new Promise(resolve=>setTimeout(resolve,650));tailRecorder.stop();await tailDone;
      const tailDecoded=await e.ctx.decodeAudioData(await new Blob(tailChunks,{type:mime}).arrayBuffer()),tail880=magnitude(tailDecoded.getChannelData(0),880,.15,.5);assert(tail880>.002,'Recorded FX tail was missing after dry source stopped');
      return {bytes:blob.size,duration:decoded.duration,fxMaster880Hz:master,headphoneSampler440Hz:cue,recordedMasterSampler440Hz:recordedSampler,recordedFxDeck880Hz:recordedDeck,recordedFxTail880Hz:tail880};
    }finally{e.decks.forEach(d=>d.pause());e.sampler.stopAll();await e.ctx.close();}
  }]
];
