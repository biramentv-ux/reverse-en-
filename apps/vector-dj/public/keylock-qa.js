import {AudioEngine} from './engine.js';
import {pulseEdges} from './keylock-metrics.js';
const sr=48000;
const assert=(value,message)=>{if(!value)throw new Error(message);};
function engineFor(seconds){const context=new OfflineAudioContext(2,Math.ceil(seconds*sr),sr),engine=new AudioEngine();engine.buildGraph(context);for(const gate of [engine.stereoGate,engine.splitGate]){gate.gain.cancelScheduledValues(0);gate.gain.value=0;}return {engine,context};}
function tone(context,seconds=1.5){const buffer=context.createBuffer(2,Math.ceil(seconds*sr),sr);for(let ch=0;ch<2;ch++){const data=buffer.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=.3*Math.sin(2*Math.PI*(ch===0?440:660)*i/sr);}return buffer;}
function hz(data,from=.4,to=1){const positions=[];for(let i=Math.ceil(from*sr)+1;i<to*sr;i++)if(data[i-1]<0&&data[i]>=0)positions.push(i-1-data[i-1]/(data[i]-data[i-1]));return (positions.length-1)*sr/(positions.at(-1)-positions[0]);}
function rms(data,from,to){let sum=0,n=0;for(let i=Math.floor(from*sr);i<Math.min(data.length,to*sr);i++){sum+=data[i]**2;n++;}return Math.sqrt(sum/n);}
async function pitchCheck(rate){
  const {engine:e,context:c}=engineFor(3),d=e.decks[0];d.load(tone(c));await d.setKeyLock(true);d.setRate(rate);d.play(.15);d.sourceGain.connect(c.destination);
  const result=await c.startRendering(),left=result.getChannelData(0),right=result.getChannelData(1),leftHz=hz(left),rightHz=hz(right);
  let first=-1,last=-1;for(let i=0;i<left.length;i++)if(Math.abs(left[i])>.025){if(first<0)first=i;last=i;}
  const activeDuration=(last-first)/sr,expected=1.5/rate,tailRms=rms(left,2.4,2.9);
  const measured=JSON.stringify({leftHz,rightHz,activeDuration,expected,first:first/sr,last:last/sr});
  assert(Math.abs(leftHz-440)<1&&Math.abs(rightHz-660)<1,`Pitch changed with key lock: ${measured}`);assert(Math.abs(activeDuration-expected)<.04,`Tempo duration is incorrect or the tail was cut: ${measured}`);assert(tailRms<1e-7,'Audio remained after natural end');
  return {rate,leftHz,rightHz,activeDuration,expectedDuration:expected,tailRms};
}
async function syncCheck(masterLock,followerLock){
  const {engine:e,context:c}=engineFor(12),a={bpm:120,gridAnchor:.113},b={bpm:124,gridAnchor:.217};
  function pulses(grid){const buffer=c.createBuffer(1,sr*17,sr),data=buffer.getChannelData(0);for(let t=grid.gridAnchor;t<17;t+=60/grid.bpm)for(let n=0;n<96;n++){const i=Math.round(t*sr)+n;if(i<data.length)data[i]=.5;}return buffer;}
  e.decks[0].load(pulses(a));e.decks[1].load(pulses(b));if(masterLock)await e.decks[0].setKeyLock(true);if(followerLock)await e.decks[1].setKeyLock(true);
  e.decks[0].seek(1.37);e.decks[1].seek(4.15);e.decks[0].play();const plan=e.syncTo(1,b,a);
  const probe=c.createChannelMerger(2);e.decks[0].sourceGain.connect(probe,0,0);e.decks[1].sourceGain.connect(probe,0,1);probe.connect(c.destination);
  const result=await c.startRendering();
  const leftEdges=pulseEdges(result.getChannelData(0),sr),rightEdges=pulseEdges(result.getChannelData(1),sr),left=leftEdges.times,right=rightEdges.times;
  assert(left.length>=18&&left.length===right.length,`Missing/extra beats: ${JSON.stringify({left:left.map(n=>n/sr),right:right.map(n=>n/sr)})}`);
  const maxError=Math.max(...left.map((value,i)=>Math.abs(value-right[i])))/sr;
  assert(maxError<.008,`Processed/unprocessed beats differ by ${(maxError*1000).toFixed(3)} ms`);
  return {masterLock,followerLock,matchedBeats:left.length,maxErrorMilliseconds:maxError*1000,scheduledStart:plan.when,secondaryThresholdEdges:leftEdges.secondaryEdges+rightEdges.secondaryEdges};
}
export const keylockChecks=[
  ['Key lock keeps stereo pitch and natural-end duration at −16%',()=>pitchCheck(.84)],
  ['Key lock keeps stereo pitch and natural-end duration at +16%',()=>pitchCheck(1.16)],
  ['Beat sync aligns a locked follower to an unlocked master',()=>syncCheck(false,true)],
  ['Beat sync aligns an unlocked follower to a locked master',()=>syncCheck(true,false)],
  ['Beat sync aligns two locked decks',()=>syncCheck(true,true)],
  ['Key-locked loop stays audible with original pitch',async()=>{
    const {engine:e,context:c}=engineFor(2.5),d=e.decks[0];d.load(tone(c));await d.setKeyLock(true);d.setRate(1.16);assert(d.setLoop(1,120),'Loop rejected');d.play(.15);d.sourceGain.connect(c.destination);
    const result=await c.startRendering(),data=result.getChannelData(0),frequency=hz(data,1.5,2.2),level=rms(data,1.5,2.2);assert(Math.abs(frequency-440)<1&&level>.05,'Key-locked loop stopped or pitch drifted');return {frequencyHz:frequency,rmsAfterOriginalEnd:level};
  }],
  ['Key-locked seek then pause clears buffered old audio',async()=>{
    const {engine:e,context:c}=engineFor(2.5),d=e.decks[0],buffer=tone(c,2);const data=buffer.getChannelData(0);for(let i=sr;i<data.length;i++)data[i]=.3*Math.sin(2*Math.PI*880*i/sr);
    d.load(buffer);await d.setKeyLock(true);d.play(.15);
    // Probe the shared per-deck path: new voices reconnect through it after seeking.
    d.filter.connect(c.destination);
    const seekPause=c.suspend(.5),rendering=c.startRendering();await seekPause;d.seek(1.2);const stopPause=c.suspend(1.3);await c.resume();await stopPause;d.pause();await c.resume();const result=await rendering,left=result.getChannelData(0);
    const afterSeekHz=hz(left,.8,1.1),afterPauseRms=rms(left,1.5,2.2);assert(Math.abs(afterSeekHz-880)<2,'Old audio survived seek');assert(afterPauseRms<1e-7,'Buffered audio survived pause');return {afterSeekHz,afterPauseRms};
  }],
  ['Key lock preserves pitch during two live tempo changes',async()=>{
    const {engine:e,context:c}=engineFor(3.5),d=e.decks[0];d.load(tone(c,2.5));await d.setKeyLock(true);d.play(.15);d.sourceGain.connect(c.destination);
    const first=c.suspend(.6),rendering=c.startRendering();await first;d.setRate(1.16);const second=c.suspend(1.3);await c.resume();await second;d.setRate(.84);await c.resume();const result=await rendering,data=result.getChannelData(0);
    const fastHz=hz(data,.9,1.2),slowHz=hz(data,1.7,2.2);assert(Math.abs(fastHz-440)<1&&Math.abs(slowHz-440)<1,`Pitch drift during tempo change: ${fastHz}/${slowHz}`);return {fastHz,slowHz,tailRms:rms(data,3.2,3.4)};
  }],
  ['A tempo change during key-lock preroll does not leak a canceled voice',async()=>{
    const {engine:e,context:c}=engineFor(2),d=e.decks[0];d.load(tone(c));await d.setKeyLock(true);d.play(.15);d.setRate(1.16);d.filter.connect(c.destination);
    const result=await c.startRendering(),data=result.getChannelData(0),frequency=hz(data,.4,1),early=rms(data,0,.14);assert(early<1e-7&&Math.abs(frequency-440)<1,'Canceled preroll leaked or changed pitch');return {frequencyHz:frequency,rmsBeforeAudibleStart:early};
  }],
  ['Recording with key lock excludes the headphone-only deck',async()=>{
    const e=new AudioEngine();e.buildGraph(new AudioContext({sampleRate:sr}));for(const gate of [e.stereoGate,e.splitGate]){gate.gain.cancelScheduledValues(0);gate.gain.value=0;}
    try{
      e.decks[0].load(tone(e.ctx,2));const master=tone(e.ctx,2);for(let ch=0;ch<2;ch++){const data=master.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=.2*Math.sin(2*Math.PI*880*i/sr);}e.decks[1].load(master);
      for(const d of e.decks.slice(0,2))await d.setKeyLock(true);e.decks[0].level.gain.value=0;e.decks[0].setCue(true);e.setCrossfade(1);e.decks[1].setRate(1.16);await e.ctx.resume();
      const mime=['audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));assert(mime,'No recording codec');const recorder=new MediaRecorder(e.recordBus.stream,{mimeType:mime}),chunks=[];
      const done=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>chunks.push(event.data);recorder.onstop=resolve;recorder.onerror=()=>reject(new Error('Recording failed'));});
      recorder.start();e.decks.forEach(d=>d.play());await new Promise(resolve=>setTimeout(resolve,1100));recorder.stop();await done;
      const blob=new Blob(chunks,{type:mime}),decoded=await e.ctx.decodeAudioData(await blob.arrayBuffer()),data=decoded.getChannelData(0);
      function amplitude(hz){let real=0,imag=0,count=0;for(let i=sr*.3;i<Math.min(data.length,sr*.8);i++){real+=data[i]*Math.cos(2*Math.PI*hz*i/sr);imag+=data[i]*Math.sin(2*Math.PI*hz*i/sr);count++;}return 2*Math.hypot(real,imag)/count;}
      const masterAmplitude=amplitude(880),cueLeak=amplitude(440);assert(masterAmplitude>.03&&cueLeak<masterAmplitude*.01,'Recorded pitch changed or cue leaked');return {bytes:blob.size,duration:decoded.duration,master880Hz:masterAmplitude,cue440HzLeak:cueLeak};
    }finally{e.decks.forEach(d=>d.pause());await e.ctx.close();}
  }]
];
