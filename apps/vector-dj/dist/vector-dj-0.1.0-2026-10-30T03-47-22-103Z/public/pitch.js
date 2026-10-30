export const PITCH_PREROLL=.09;
export const PITCH_PREFIX=.12;
const modules=new WeakMap();
export async function registerPitch(context){
  if(context.sampleRate!==48000)throw new Error('Key lock currently requires a 48 kHz audio context.');
  if(!context.audioWorklet)throw new Error('Key lock needs AudioWorklet support. Try current Chrome.');
  if(!modules.has(context))modules.set(context,context.audioWorklet.addModule('/vendor/soundtouch-2.1.1/orbit-pitch-processor.js').catch(error=>{modules.delete(context);throw error;}));
  await modules.get(context);
}
export function pitchLatency(rate){
  // Measured transient medians at 48 kHz, short WSOLA profile. Timing is approximate:
  // the algorithm's transient search adds a few milliseconds of residual variation.
  if(rate<=1)return .03619047619047633+(rate-.84)/.16*(.039-.03619047619047633);
  return .039+(rate-1)/.16*(.03841379310344806-.039);
}
export function paddedPitchBuffer(context,buffer){
  const prefix=Math.round(PITCH_PREFIX*context.sampleRate),tail=Math.ceil(.25*context.sampleRate);
  const result=context.createBuffer(buffer.numberOfChannels,buffer.length+prefix+tail,buffer.sampleRate);
  for(let ch=0;ch<buffer.numberOfChannels;ch++)result.copyToChannel(buffer.getChannelData(ch),ch,prefix);
  return result;
}
export function pitchNode(context,rate){
  const node=new AudioWorkletNode(context,'orbit-pitch-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{stretchParameters:{sequenceMs:30,seekWindowMs:10,overlapMs:8,quickSeek:false}}});
  node.parameters.get('pitch').value=1;node.parameters.get('playbackRate').value=rate;
  return node;
}
