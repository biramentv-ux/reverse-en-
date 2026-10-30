import test from 'node:test';
import assert from 'node:assert/strict';
import { crossfade, positionAt, waveform, estimateBpm, synthesize } from '../public/dsp.js';

test('equal-power crossfader endpoints and power remain correct across its travel',()=>{
  assert.deepEqual(crossfade(0),[1,0]); assert.ok(crossfade(1)[0]<1e-10);assert.equal(crossfade(1)[1],1);
  for(let i=0;i<=100;i++){const [a,b]=crossfade(i/100);assert.ok(Math.abs(a*a+b*b-1)<1e-12);}
  assert.deepEqual(crossfade(-1),crossfade(0));assert.deepEqual(crossfade(2),crossfade(1));
});
test('transport wraps loop positions over multiple cycles and respects playback rate',()=>{
  assert.equal(positionAt(2,5,1.2,60,null),8);
  assert.equal(positionAt(2,9,1,60,{start:2,end:6}),3);
  assert.equal(positionAt(2,4,1,60,{start:2,end:6}),2);
  assert.equal(positionAt(20,50,1,32,null),32);
  assert.equal(positionAt(2,0,1,32,null),2);
});
test('waveform reports real amplitudes, including negative transients and silence',()=>{
  assert.deepEqual(waveform(new Float32Array([0,-1,.25,.5]),2),[1,.5]);
  assert.ok(waveform(new Float32Array(2000)).every(x=>x===0));
  const tail = new Float32Array(1201); tail[1200] = -0.9;
  assert.ok(waveform(tail,600).at(-1) > .89, 'final sample must not be omitted');
});
test('BPM estimator detects pulse trains and refuses silence or insufficient data',()=>{
  const rate=8000;
  for(const bpm of [90,120,128,150]){
    const data=new Float32Array(rate*20),beat=rate*60/bpm;
    for(let pos=0;pos<data.length;pos+=beat) for(let i=0;i<rate*.03;i++) if(Math.round(pos)+i<data.length)data[Math.round(pos)+i]=.8*Math.exp(-i/80);
    assert.ok(Math.abs(estimateBpm(data,rate)-bpm)<2,`BPM ${bpm}`);
  }
  assert.equal(estimateBpm(new Float32Array(rate*10),rate),null);
  assert.equal(estimateBpm(new Float32Array(4),rate),null);
});
test('original demo audio is deterministic, finite, bounded and non-silent',()=>{
  const samples=synthesize(8000,120,1,2),again=synthesize(8000,120,1,2);
  assert.equal(samples.length,32000);assert.deepEqual(samples,again);
  let peak=0;for(const x of samples){assert.ok(Number.isFinite(x));peak=Math.max(peak,Math.abs(x));}
  assert.ok(peak>.4&&peak<1);assert.ok(Math.abs(estimateBpm(synthesize(8000,128,3),8000)-128)<2);
});
