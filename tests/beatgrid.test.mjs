import test from 'node:test';
import assert from 'node:assert/strict';
import {beatPhase,quantizePosition,beatLoop,syncPlan} from '../public/beatgrid.js';
import {positionAt} from '../public/dsp.js';
const phaseError=(a,b)=>Math.min(Math.abs(a-b),1-Math.abs(a-b));

test('cue quantization follows a non-zero anchor and stays on a real grid point',()=>{
  assert.equal(quantizePosition(1.1,120,.12,20),1.12);
  assert.equal(quantizePosition(0,120,.12,20),.12);
  assert.ok(Math.abs(quantizePosition(19.99,120,.12,20)-19.62)<1e-12);
  assert.throws(()=>quantizePosition(0,120,.3,.1));
});
test('loops preserve complete beat lengths and reject a partial loop near EOF',()=>{
  assert.deepEqual(beatLoop(1.3,120,.12,4,20),{start:1.12,end:3.12});
  assert.equal(beatLoop(19.8,120,.12,4,20),null);
  assert.deepEqual(beatLoop(0,120,.12,1,20),{start:.12,end:.62});
  assert.equal(beatLoop(0,120,0,0,20),null);
});
test('beat alignment matches phase and effective BPM with different anchors',()=>{
  const p=syncPlan({followerPosition:15.17,followerBpm:124,followerAnchor:.217,duration:5000,masterPosition:7.31,masterBpm:120,masterAnchor:.113,masterRate:1.04});
  assert.ok(Math.abs(p.rate*124-120*1.04)<1e-10);
  assert.ok(phaseError(beatPhase(p.position,124,.217),beatPhase(7.31,120,.113))<1e-10);
  assert.ok(Math.abs(p.position-15.17)<60/124/2+1e-10);
  for(const elapsed of [0,.017,1,60,600,1800]) {
    const master=7.31+elapsed*1.04,follower=p.position+elapsed*p.rate;
    assert.ok(phaseError(beatPhase(master,120,.113),beatPhase(follower,124,.217))<1e-9,`phase drift at ${elapsed}s`);
  }
});
test('alignment preserves phase at file boundaries and across integer beat loops',()=>{
  const config={followerPosition:0,followerBpm:128,followerAnchor:.2,duration:10,masterPosition:7.31,masterBpm:120,masterAnchor:.113,masterRate:1};
  for(const position of [0,9.999]){const p=syncPlan({...config,followerPosition:position});assert.ok(p.position>=0&&p.position<10);assert.ok(phaseError(beatPhase(p.position,128,.2),p.phase)<1e-10);}
  const loop=beatLoop(1.3,128,.2,8,10),p=syncPlan({...config,followerPosition:loop.start,loop});
  for(const elapsed of [0,1,100,600])assert.ok(phaseError(beatPhase(positionAt(p.position,elapsed,p.rate,10,loop),128,.2),beatPhase(config.masterPosition+elapsed,120,.113))<1e-9);
  assert.throws(()=>syncPlan({...config,duration:.01}));
  assert.throws(()=>syncPlan({...config,followerBpm:0}));
});
