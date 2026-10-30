import test from 'node:test';
import assert from 'node:assert/strict';
import {pulseEdges} from '../public/keylock-metrics.js';
import {Deck} from '../public/engine.js';
test('transient detector groups pulse-internal edges but preserves an actual extra pulse',()=>{
  const sr=1000,data=new Float32Array(3000);for(const i of [500,502,1000,1500,1600])data[i]=.5;
  const result=pulseEdges(data,sr,0,3);assert.deepEqual(result.times,[500,1000,1500,1600]);assert.equal(result.secondaryEdges,1);
});
test('deck clock applies future rate changes at audible time and cancels replaced future state',()=>{
  const deck=Object.create(Deck.prototype);deck.buffer={duration:100};deck.rate=1;deck.loop=null;deck.timeline=[{at:0,offset:2,rate:1,playing:true,loop:null}];
  deck.recordState(10,12,true,1.16);
  assert.equal(deck.positionAtTime(9),11);assert.equal(deck.rateAtTime(9),1);assert.equal(deck.positionAtTime(10),12);assert.equal(deck.rateAtTime(10),1.16);assert.ok(Math.abs(deck.positionAtTime(15)-17.8)<1e-10);
  deck.recordState(8,10,false,1);assert.equal(deck.positionAtTime(15),10);assert.equal(deck.timeline.length,2);
});
test('scheduled deck start holds its cue position until the audible start',()=>{
  const deck=Object.create(Deck.prototype);deck.buffer={duration:10};deck.rate=1;deck.loop=null;deck.timeline=[{at:0,offset:1,rate:1,playing:false,loop:null}];
  deck.recordState(.115,1,true);assert.equal(deck.positionAtTime(.1),1);assert.ok(Math.abs(deck.positionAtTime(.215)-1.1)<1e-10);
});
