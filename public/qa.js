import { AudioEngine } from './engine.js';
import { beatPhase } from './beatgrid.js';
import {keylockChecks} from './keylock-qa.js';
import {performanceChecks} from './performance-qa.js';
import {fourDeckChecks} from './fourdeck-qa.js';
const rate=48000;
function assert(condition,message){if(!condition)throw new Error(message);}
function rms(data,start=.2,end=.6){let sum=0,n=0;for(let i=Math.floor(start*rate);i<Math.min(data.length,end*rate);i++){sum+=data[i]**2;n++;}return Math.sqrt(sum/n);}
function frequency(data,hz){let re=0,im=0,n=0;for(let i=rate*.2;i<rate*.6;i++){re+=data[i]*Math.cos(2*Math.PI*hz*i/rate);im+=data[i]*Math.sin(2*Math.PI*hz*i/rate);n++;}return 2*Math.hypot(re,im)/n;}
function tone(ctx,hz=440,rightOnly=false,duration=1){const b=ctx.createBuffer(2,Math.ceil(duration*rate),rate);for(let ch=0;ch<2;ch++){const samples=b.getChannelData(ch);for(let i=0;i<samples.length;i++)samples[i]=rightOnly&&ch===0?0:.2*Math.sin(2*Math.PI*hz*i/rate);}return b;}
async function render(config){const ctx=new OfflineAudioContext(2,rate,rate),e=new AudioEngine();e.buildGraph(ctx);await config(e,ctx);return ctx.startRendering();}
const tests=[
  ['Stereo master excludes PFL when a deck is muted',async()=>{
    const out=await render((e,c)=>{e.decks[0].load(tone(c));e.decks[0].level.gain.value=0;e.decks[0].setCue(true);e.decks[0].play();});
    const values=[rms(out.getChannelData(0)),rms(out.getChannelData(1))];assert(values.every(n=>n<1e-7),'PFL leaked into stereo speakers');return {leftRms:values[0],rightRms:values[1]};
  }],
  ['Split PFL stays on LEFT, independent of fader, crossfader and master volume',async()=>{
    const out=await render((e,c)=>{e.setOutputMode('split');e.setMaster(0);e.setCrossfade(1);e.decks[0].load(tone(c));e.decks[0].level.gain.value=0;e.decks[0].setCue(true);e.decks[0].play();});
    const left=rms(out.getChannelData(0)),right=rms(out.getChannelData(1));assert(left>.04,'Headphone preview is silent');assert(right<1e-7,'Headphone preview leaked into master');return {leftRms:left,rightRms:right};
  }],
  ['Split master stays on RIGHT and includes both channels of a stereo source',async()=>{
    const out=await render((e,c)=>{e.setOutputMode('split');e.decks[0].load(tone(c,440,true));e.decks[0].play();});
    const left=rms(out.getChannelData(0)),right=rms(out.getChannelData(1));assert(left<1e-7,'Master leaked into headphones');assert(right>.02,'Right source channel was lost in downmix');return {leftRms:left,rightRms:right};
  }],
  ['Crossfader endpoint excludes the opposite deck in rendered audio',async()=>{
    const out=await render((e,c)=>{e.setCrossfade(0);e.decks[0].load(tone(c,440));e.decks[1].load(tone(c,880));e.decks.forEach(d=>d.play());});
    const signal=frequency(out.getChannelData(0),440),leak=frequency(out.getChannelData(0),880);assert(signal>.05,'Deck A signal missing');assert(leak<signal*.001,'Deck B leaks through crossfader endpoint');return {deckAAmplitude:signal,deckBLeak:leak};
  }],
  ['Low EQ attenuates bass by at least 12 dB',async()=>{
    const baseline=await render((e,c)=>{e.decks[0].load(tone(c,80));e.decks[0].play();});
    const cut=await render((e,c)=>{e.decks[0].load(tone(c,80));e.decks[0].low.gain.value=-24;e.decks[0].play();});
    const attenuation=20*Math.log10(rms(cut.getChannelData(0))/rms(baseline.getChannelData(0)));assert(attenuation< -12,'Bass EQ did not attenuate');return {attenuationDb:attenuation};
  }],
  ['A short source keeps sounding while loop is active',async()=>{
    const out=await render((e,c)=>{e.decks[0].load(tone(c,440,false,.1));e.decks[0].setLoop(.1,120);e.decks[0].play();});
    const value=rms(out.getChannelData(0),.5,.8);assert(value>.03,'Loop stopped at the original source end');return {rmsAfterSourceEnd:value};
  }],
  ['A non-looped source ends without repeating',async()=>{
    const out=await render((e,c)=>{e.decks[0].load(tone(c,440,false,.1));e.decks[0].play();});
    const value=rms(out.getChannelData(0),.5,.8);assert(value<1e-6,'Source kept sounding after its end');return {rmsAfterSourceEnd:value};
  }],
  ['Beat sync aligns actual source impulses at different BPM and grid anchors',async()=>{
    const c=new OfflineAudioContext(2,rate*12,rate),e=new AudioEngine();e.buildGraph(c);
    for(const node of [e.stereoGate,e.splitGate]){node.gain.cancelScheduledValues(0);node.gain.value=0;}
    const gridA={bpm:120,gridAnchor:.113},gridB={bpm:124,gridAnchor:.217};
    function pulses(grid){const buffer=c.createBuffer(1,rate*17,rate),data=buffer.getChannelData(0);for(let t=grid.gridAnchor;t<17;t+=60/grid.bpm)for(let n=0;n<96;n++){const i=Math.round(t*rate)+n;if(i<data.length)data[i]=.5;}return buffer;}
    e.decks[0].load(pulses(gridA));e.decks[1].load(pulses(gridB));e.decks[0].seek(1.37);e.decks[1].seek(4.15);e.decks[0].play();
    const plan=e.syncTo(1,gridB,gridA);
    // Probe each real AudioBufferSource separately, before the unequal master/cue processing paths.
    // Mixer and recording paths are independently rendered in the other checks.
    const probe=c.createChannelMerger(2);e.decks[0].source.connect(probe,0,0);e.decks[1].source.connect(probe,0,1);probe.connect(c.destination);
    const rendered=await c.startRendering();
    function onsets(data){const result=[];for(let i=rate*.5;i<rate*10;i++)if(data[i]>.1&&data[i-1]<=.1)result.push(i);return result;}
    const a=onsets(rendered.getChannelData(0)),b=onsets(rendered.getChannelData(1));
    assert(a.length>=18&&a.length===b.length,'Missing or extra synchronized impulses');
    const maxError=Math.max(...a.map((sample,i)=>Math.abs(sample-b[i])));
    assert(maxError<=3,'Beat sync error exceeds three samples');
    return {matchedBeats:a.length,maxErrorSamples:maxError,maxErrorMilliseconds:maxError/rate*1000,rate:plan.rate,scheduledStart:plan.when};
  }],
  ['Beat sync rejects a stopped master without moving the follower',async()=>{
    const c=new OfflineAudioContext(2,rate,rate),e=new AudioEngine();e.buildGraph(c);e.decks.forEach(d=>d.load(tone(c)));
    e.decks[1].seek(.27);const before=e.decks[1].position();let rejected=false;
    try{e.syncTo(1,{bpm:120},{bpm:124});}catch{rejected=true;}
    assert(rejected,'Stopped master was accepted');assert(e.decks[1].position()===before&&!e.decks[1].playing,'Rejected sync changed transport');
    return {rejected,position:before,playing:e.decks[1].playing};
  }],
  ['Seeking to the end stops playback instead of restarting the track',async()=>{
    const c=new OfflineAudioContext(2,rate,rate),e=new AudioEngine();e.buildGraph(c);const d=e.decks[0];d.load(tone(c));d.play();d.seek(d.buffer.duration);
    assert(!d.playing&&d.position()===d.buffer.duration,'Seeking to end restarted playback');
    const rendered=await c.startRendering(),value=rms(rendered.getChannelData(0));assert(value<1e-7,'Audio continued after end seek');
    return {playing:d.playing,position:d.position(),rmsAfterSeek:value};
  }],
  ['An incomplete EOF loop is rejected without changing the current transport',async()=>{
    const c=new OfflineAudioContext(2,rate,rate),e=new AudioEngine();e.buildGraph(c);const d=e.decks[0];d.load(tone(c));d.seek(.9);
    const accepted=d.setLoop(4,120,.1);assert(!accepted&&d.loop===null&&d.position()===.9,'Rejected loop changed position or length');
    return {accepted,position:d.position(),loop:d.loop};
  }],
  ['Recorded master decodes and excludes the headphone-only deck',async()=>{
    const e=new AudioEngine();
    // Live context is needed by MediaRecorder. Silence only the hardware branches;
    // the recording branch stays connected to the same limiter used by the studio.
    e.buildGraph(new AudioContext({sampleRate:rate}));
    for(const node of [e.stereoGate,e.splitGate]){node.gain.cancelScheduledValues(0);node.gain.setValueAtTime(0,0);}
    try {
      await e.ctx.resume();assert(e.ctx.state==='running','AudioContext did not start');
      e.decks[0].load(tone(e.ctx,440));e.decks[0].level.gain.value=0;e.decks[0].setCue(true);
      e.decks[1].load(tone(e.ctx,880));e.setCrossfade(1);
      const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
      assert(mime,'No recording codec');
      const chunks=[],recorder=new MediaRecorder(e.recordBus.stream,{mimeType:mime});
      const finished=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>chunks.push(event.data);recorder.onstop=resolve;recorder.onerror=()=>reject(new Error('MediaRecorder error'));});
      recorder.start();e.decks.forEach(d=>d.play());
      await new Promise(resolve=>setTimeout(resolve,1000));recorder.stop();await finished;
      const blob=new Blob(chunks,{type:mime});assert(blob.size>1000,'Empty recording');
      const decoded=await e.ctx.decodeAudioData(await blob.arrayBuffer());
      const master=frequency(decoded.getChannelData(0),880),cueLeak=frequency(decoded.getChannelData(0),440);
      assert(decoded.duration>.7,'Recording is too short');assert(master>.02,'Recorded master is silent');assert(cueLeak<master*.01,'Headphone-only signal leaked into recording');
      return {codec:mime,bytes:blob.size,duration:decoded.duration,channels:decoded.numberOfChannels,master880Hz:master,cue440HzLeak:cueLeak};
    } finally { e.decks.forEach(d=>d.pause());await e.ctx.close(); }
  }]
];
tests.push(...keylockChecks);
tests.push(...performanceChecks);
tests.push(...fourDeckChecks);
document.querySelector('#run-tests').onclick=async()=>{
  const button=document.querySelector('#run-tests'),list=document.querySelector('#results');button.disabled=true;list.replaceChildren();let passed=0;
  for(const [name,run] of tests){const item=document.createElement('li'),title=document.createElement('strong'),detail=document.createElement('pre');title.textContent=name;item.append(title,detail);list.append(item);try{const evidence=await run();item.className='pass';title.textContent=`PASS · ${name}`;detail.textContent=JSON.stringify(evidence,null,2);passed++;}catch(error){item.className='fail';title.textContent=`FAIL · ${name}`;detail.textContent=error.message;}document.querySelector('#qa-status').textContent=`${passed} passed · ${list.children.length} / ${tests.length} completed`;}
  document.querySelector('#qa-status').textContent=`${passed} / ${tests.length} audio checks passed`;button.disabled=false;
};
