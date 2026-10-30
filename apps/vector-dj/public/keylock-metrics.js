export function signal(sampleRate,seconds,padding,kind){
  return [0,1].map(channel=>{
    const samples=new Float32Array(Math.ceil((seconds+padding)*sampleRate));
    for(let i=0;i<seconds*sampleRate;i++){
      const t=i/sampleRate;
      if(kind==='tone')samples[i]=.3*Math.sin(2*Math.PI*(channel===0?440:660)*t)*Math.min(1,t/.01,(seconds-t)/.01);
      else {const phase=(t-.2+.5)%.5;samples[i]=t>=.2&&phase<.012?.4*Math.sin(2*Math.PI*1000*phase):0;}
    }
    return samples;
  });
}
export function analyzeTone(channels,sampleRate,rate,seconds=4){
  function frequency(samples){const crossings=[];for(let i=sampleRate+1;i<Math.min(samples.length,2.5*sampleRate);i++)if(samples[i-1]<0&&samples[i]>=0)crossings.push(i-1-samples[i-1]/(samples[i]-samples[i-1]));return (crossings.length-1)*sampleRate/(crossings.at(-1)-crossings[0]);}
  let first=-1,last=-1;for(let i=0;i<channels[0].length;i++)if(Math.abs(channels[0][i])>.03){if(first<0)first=i;last=i;}
  const leftHz=frequency(channels[0]),rightHz=frequency(channels[1]),activeDuration=(last-first)/sampleRate,durationError=activeDuration-seconds/rate;
  return {pass:Math.abs(leftHz-440)<1&&Math.abs(rightHz-660)<1&&Math.abs(durationError)<.08,rate,leftHz,rightHz,expectedDuration:seconds/rate,activeDuration,durationError,initialLatency:first/sampleRate};
}
export function analyzeTransients(data,sampleRate,rate){
  const onsets=[];let previous=-Infinity;const window=Math.round(sampleRate*.001);
  for(let i=0;i<data.length-window;i+=window){let peak=0;for(let j=0;j<window;j++)peak=Math.max(peak,Math.abs(data[i+j]));if(peak>.07&&i/sampleRate-previous>.15){onsets.push(i/sampleRate);previous=i/sampleRate;}}
  const offsets=onsets.map((t,i)=>t-(.2+i*.5)/rate),ordered=[...offsets].sort((a,b)=>a-b),median=ordered[Math.floor(ordered.length/2)],jitter=Math.max(...offsets.map(n=>Math.abs(n-median)));
  return {pass:onsets.length===12&&jitter<.015,rate,beats:onsets.length,medianLatency:median,maxTimingDeviation:jitter,onsets};
}
export function pulseEdges(data,sampleRate,from=.5,to=10){
  const times=[];let secondaryEdges=0;
  // A stretched 2 ms pulse may cross the threshold twice inside one transient.
  // Group edges within 20 ms; a distinct pulse after that still counts separately.
  for(let i=Math.ceil(sampleRate*from)+1;i<Math.min(data.length,sampleRate*to);i++)if(data[i]>.1&&data[i-1]<=.1){if(times.length&&i-times.at(-1)<sampleRate*.02)secondaryEdges++;else times.push(i);}
  return {times,secondaryEdges};
}
