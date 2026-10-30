import vm from 'node:vm';
import {readFile,writeFile} from 'node:fs/promises';
import {signal,analyzeTone,analyzeTransients} from '../public/keylock-metrics.js';
const rateHz=48000,block=128;
const profile=process.argv.includes('--short')?'short':'default';
const source=await readFile(new URL('../public/vendor/soundtouch-2.1.1/soundtouch-processor.js',import.meta.url),'utf8');
let Processor;
const sandbox=vm.createContext({sampleRate:rateHz,console,AudioWorkletProcessor:class{constructor(){this.port={postMessage(){},onmessage:null};}},registerProcessor(name,type){Processor=type;}});
vm.runInContext(source,sandbox,{filename:'soundtouch-processor.js'});
function render(rate,kind){
  const seconds=kind==='tone'?4:6,padding=.8,input=signal(rateHz,seconds,padding,kind),length=Math.ceil(input[0].length/rate);
  const output=[new Float32Array(length),new Float32Array(length)],processor=new Processor({processorOptions:{}});
  if(profile==='short')processor.port.onmessage({data:{type:'set-stretch-parameters',params:{sequenceMs:30,seekWindowMs:10,overlapMs:8,quickSeek:false}}});
  const parameters={pitch:new Float32Array([1]),pitchSemitones:new Float32Array([0]),playbackRate:new Float32Array([rate])};
  for(let offset=0;offset<length;offset+=block){
    const incoming=[new Float32Array(block),new Float32Array(block)],outgoing=[new Float32Array(block),new Float32Array(block)];
    for(let ch=0;ch<2;ch++)for(let i=0;i<block;i++){const pos=(offset+i)*rate,index=Math.floor(pos),fraction=pos-index;incoming[ch][i]=(input[ch][index]||0)*(1-fraction)+(input[ch][index+1]||0)*fraction;}
    processor.process([incoming],[outgoing],parameters);
    for(let ch=0;ch<2;ch++)output[ch].set(outgoing[ch].subarray(0,Math.min(block,length-offset)),offset);
  }
  return output;
}
const results=[];
for(const rate of [.84,1,1.16])for(const kind of ['tone','transients']){
  const channels=render(rate,kind),measurement=kind==='tone'?analyzeTone(channels,rateHz,rate):analyzeTransients(channels[0],rateHz,rate);
  results.push({kind,...measurement});console.log(`${measurement.pass?'PASS':'FAIL'} ${kind} ${rate}x ${JSON.stringify(measurement)}`);
}
const report={environment:'Node processor harness, not a browser or physical device; source resampling is linear',profile,library:'@soundtouchjs/audio-worklet@2.1.1',passed:results.filter(x=>x.pass).length,total:results.length,results};
await writeFile(new URL(`../output/keylock-candidate-node-${profile}.json`,import.meta.url),JSON.stringify(report,null,2));
if(report.passed!==report.total)process.exitCode=1;
