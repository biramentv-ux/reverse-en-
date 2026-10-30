import test from 'node:test';
import assert from 'node:assert/strict';
import {echoSeconds} from '../public/effects.js';
import {sampleRegion} from '../public/sampler.js';
test('echo division follows the effective musical tempo',()=>{
  assert.equal(echoSeconds(120,.5),.25);assert.equal(echoSeconds(60,2),2);
  assert.ok(Math.abs(echoSeconds(120*1.16,1)-.4310344827586207)<1e-12);
  assert.throws(()=>echoSeconds(0,.5));assert.throws(()=>echoSeconds(120,-1));assert.throws(()=>echoSeconds(1,2));
});
test('sampler trims at EOF and rejects invalid or oversized clips',()=>{
  assert.deepEqual(sampleRegion(32,2,4),{start:2,duration:4});assert.deepEqual(sampleRegion(3,2.5,1),{start:2.5,duration:.5});
  assert.ok(sampleRegion(3,2.95,.05).duration>.05-1e-9,'Exact 50 ms EOF trim must survive floating point rounding');
  for(const args of [[32,-1,2],[32,0,31],[32,32,1],[1,.99,.1],[32,NaN,1],[32,0,0]])assert.throws(()=>sampleRegion(...args));
});
