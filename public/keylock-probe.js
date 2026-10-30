const sampleRate=48000,processorUrl='/vendor/soundtouch-2.1.1/soundtouch-processor.js';
function frequency(samples,start,end){const crossings=[];for(let i=Math.floor(start*sampleRate)+1;i<Math.min(samples.length,end*sampleRate);i++)if(samples[i-1]<0&&samples[i]>=0)crossings.push(i-1-samples[i-1]/(samples[i]-samples[i-1]));return (crossings.length-1)*sampleRate/(crossings.at(-1)-crossings[0]);}
function edges(samples,threshold=.03){let start=-1,end=-1;for(let i=0;i<samples.length;i++)if(Math.abs(samples[i])>threshold){if(start<0)start=i;end=i;}return {start:start/sampleRate,end:end/sampleRate,duration:(end-start)/sampleRate};}
async function render(rate,kind,profile){
  const toneSeconds=kind==='tone'?4:6,padding=.8;
  const context=new OfflineAudioContext(2,Math.ceil((toneSeconds+padding)/rate*sampleRate),sampleRate);
  await context.audioWorklet.addModule(processorUrl);
  const node=new AudioWorkletNode(context,'soundtouch-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
  if(profile==='short')node.port.postMessage({type:'set-stretch-parameters',params:{sequenceMs:30,seekWindowMs:10,overlapMs:8,quickSeek:false}});
  node.parameters.get('playbackRate').value=rate;node.parameters.get('pitch').value=1;
  const buffer=context.createBuffer(2,Math.ceil((toneSeconds+padding)*sampleRate),sampleRate);
  for(let channel=0;channel<2;channel++){
    const samples=buffer.getChannelData(channel);
    for(let i=0;i<toneSeconds*sampleRate;i++){
      const t=i/sampleRate;
      if(kind==='tone')samples[i]=.3*Math.sin(2*Math.PI*(channel===0?440:660)*t)*Math.min(1,t/.01,(toneSeconds-t)/.01);
      else {const phase=(t-.2+.5)% .5;samples[i]=t>=.2&&phase<.012?.4*Math.sin(2*Math.PI*1000*phase):0;}
    }
  }
  const source=context.createBufferSource();source.buffer=buffer;source.playbackRate.value=rate;source.connect(node);node.connect(context.destination);source.start();
  const output=await context.startRendering();node.port.close();return {output,toneSeconds};
}
function transientOnsets(data){const onsets=[];let previous=-Infinity;const window=48;for(let i=0;i<data.length-window;i+=window){let peak=0;for(let j=0;j<window;j++)peak=Math.max(peak,Math.abs(data[i+j]));if(peak>.07&&i/sampleRate-previous>.15){onsets.push(i/sampleRate);previous=i/sampleRate;}}return onsets;}
async function toneCheck(rate,profile){
  const {output,toneSeconds}=await render(rate,'tone',profile);
  const left=frequency(output.getChannelData(0),1,2.5),right=frequency(output.getChannelData(1),1,2.5),extent=edges(output.getChannelData(0));
  const pitchPass=Math.abs(left-440)<1&&Math.abs(right-660)<1,durationError=extent.duration-toneSeconds/rate;
  return {pass:pitchPass&&Math.abs(durationError)<.08,rate,leftHz:left,rightHz:right,expectedDuration:toneSeconds/rate,activeDuration:extent.duration,durationError,initialLatency:extent.start};
}
async function transientCheck(rate,profile){
  const {output}=await render(rate,'transients',profile),onsets=transientOnsets(output.getChannelData(0));
  const offsets=onsets.map((t,i)=>t-(.2+i*.5)/rate),ordered=[...offsets].sort((a,b)=>a-b),median=ordered[Math.floor(ordered.length/2)];
  const jitter=Math.max(...offsets.map(n=>Math.abs(n-median)));
  return {pass:onsets.length===12&&jitter<.015,rate,beats:onsets.length,medianLatency:median,maxTimingDeviation:jitter,onsets};
}
document.querySelector('#run-probe').onclick=async()=>{
  const button=document.querySelector('#run-probe'),list=document.querySelector('#results'),status=document.querySelector('#probe-status'),select=document.querySelector('#profile'),profile=select.value;button.disabled=true;select.disabled=true;list.replaceChildren();let passed=0,completed=0;
  for(const rate of [.84,1,1.16])for(const kind of ['tone','transients']){
    const item=document.createElement('li'),title=document.createElement('strong'),detail=document.createElement('pre');item.append(title,detail);list.append(item);
    title.textContent=`${kind} · ${rate}×`;
    try {const result=await(kind==='tone'?toneCheck(rate,profile):transientCheck(rate,profile));item.className=result.pass?'pass':'fail';title.textContent=`${result.pass?'PASS':'FAIL'} · ${kind} · ${rate}×`;detail.textContent=JSON.stringify(result,null,2);if(result.pass)passed++;}
    catch(error){item.className='fail';title.textContent=`FAIL · ${kind} · ${rate}×`;detail.textContent=error.message;}
    completed++;status.textContent=`${passed} passed · ${completed} / 6 completed`;
  }
  status.textContent=`${passed} / 6 candidate checks passed`;button.disabled=false;select.disabled=false;
};
