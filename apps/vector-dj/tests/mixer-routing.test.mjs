import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioEngine} from '../public/engine.js';
import {channelBlend} from '../public/mixer-routing.js';
test('Four channel assignments can be configured before audio starts and reject invalid mutations',()=>{
  const e=new AudioEngine();assert.deepEqual(e.assignments,['left','right','left','right']);
  e.setDeckAssignment(2,'thru');e.setCrossfade(0);assert.equal(e.assignments[2],'thru');
  assert.throws(()=>e.setDeckAssignment(4,'left'));assert.throws(()=>e.setDeckAssignment(2,'invalid'));assert.equal(e.assignments[2],'thru');assert.throws(()=>e.setCrossfade(NaN));assert.equal(e.fade,0);
});
test('THRU keeps full channel gain throughout crossfader travel while both side groups remain equal-power',()=>{
  for(const x of [0,.1,.25,.5,.75,.9,1]){assert.equal(channelBlend('thru',x),1);assert.ok(Math.abs(channelBlend('left',x)**2+channelBlend('right',x)**2-1)<1e-12);}
  assert.equal(channelBlend('left',0),1);assert.ok(channelBlend('right',0)<1e-12);assert.ok(channelBlend('left',1)<1e-12);assert.equal(channelBlend('right',1),1);
});
