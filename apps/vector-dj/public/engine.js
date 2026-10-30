import { positionAt } from './dsp.js';
import { beatLoop, syncPlan } from './beatgrid.js';
import {registerPitch,paddedPitchBuffer,pitchNode,pitchLatency,PITCH_PREROLL,PITCH_PREFIX} from './pitch.js';
import {DeckEffects} from './effects.js';
import {Sampler} from './sampler.js';
import {DECK_IDS,DEFAULT_ASSIGNMENTS,channelBlend} from './mixer-routing.js';

export class AudioEngine {
  constructor() { this.ctx = null; this.decks = []; this.assignments=[...DEFAULT_ASSIGNMENTS];this.masterLevel = 0.75; this.fade = 0.5; this.outputMode = 'stereo'; this.cueLevel = 0.6; }
  async init() {
    if (!this.ctx) this.buildGraph(new AudioContext({ latencyHint: 'interactive',sampleRate:48000 }));
    await this.ctx.resume();
    if (this.ctx.state !== 'running') throw new Error('Audio is suspended. Click Play again.');
  }
  buildGraph(context) {
      if (this.ctx) throw new Error('Audio graph already initialized');
      this.ctx = context;
      const c = context;
      this.master = c.createGain(); this.master.gain.value = this.masterLevel;
      this.limiter = c.createDynamicsCompressor();
      this.limiter.threshold.value = -3; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003; this.limiter.release.value = 0.15;
      this.meter = c.createAnalyser(); this.meter.fftSize = 256;
      this.recordBus = c.createMediaStreamDestination?.() || null;
      this.master.connect(this.limiter); this.limiter.connect(this.meter);
      if (this.recordBus) this.limiter.connect(this.recordBus);
      this.stereoGate = c.createGain(); this.stereoGate.gain.value = 1;
      this.splitGate = c.createGain(); this.splitGate.gain.value = 0;
      this.cueBus = c.createGain(); this.cueVolume = c.createGain(); this.cueVolume.gain.value = this.cueLevel;
      this.cueBus.connect(this.cueVolume);
      // Explicit mono downmix avoids dropping one channel of stereo tracks.
      this.monoMaster = c.createGain(); this.monoMaster.channelCount = 1; this.monoMaster.channelCountMode = 'explicit';
      this.monoCue = c.createGain(); this.monoCue.channelCount = 1; this.monoCue.channelCountMode = 'explicit';
      this.splitMerger = c.createChannelMerger(2);
      this.meter.connect(this.stereoGate); this.stereoGate.connect(c.destination);
      this.meter.connect(this.monoMaster); this.monoMaster.connect(this.splitMerger, 0, 1);
      this.cueVolume.connect(this.monoCue); this.monoCue.connect(this.splitMerger, 0, 0);
      this.splitMerger.connect(this.splitGate); this.splitGate.connect(c.destination);
      this.decks = DECK_IDS.map(()=>new Deck(this)); this.setCrossfade(this.fade);
      this.sampler=new Sampler(this);
      this.setOutputMode(this.outputMode);
  }
  setOutputMode(mode) {
    if (!['stereo', 'split'].includes(mode)) throw new Error('Unknown audio output mode');
    this.outputMode = mode;
    if (!this.ctx) return;
    this.stereoGate.gain.setTargetAtTime(mode === 'stereo' ? 1 : 0, this.ctx.currentTime, 0.015);
    this.splitGate.gain.setTargetAtTime(mode === 'split' ? 1 : 0, this.ctx.currentTime, 0.015);
  }
  setCueLevel(value) { this.cueLevel = Number(value); if (this.ctx) this.cueVolume.gain.setTargetAtTime(this.cueLevel, this.ctx.currentTime, 0.015); }
  setCrossfade(x) {channelBlend('left',x);this.fade=Math.max(0,Math.min(1,Number(x)));if(!this.ctx)return;this.decks.forEach((deck,index)=>deck.blend.gain.setTargetAtTime(channelBlend(this.assignments[index],this.fade),this.ctx.currentTime,.015));}
  setDeckAssignment(index,assignment){if(!Number.isInteger(index)||index<0||index>=DECK_IDS.length)throw new Error('Unknown mixer channel.');const gain=channelBlend(assignment,this.fade);this.assignments[index]=assignment;if(this.ctx)this.decks[index].blend.gain.setTargetAtTime(gain,this.ctx.currentTime,.015);}
  setMaster(value) { this.masterLevel = Number(value); if (this.master) this.master.gain.setTargetAtTime(this.masterLevel, this.ctx.currentTime, 0.015); }
  syncTo(index, followerGrid, masterGrid,masterIndex=index===0?1:0) {
    if(index===masterIndex)throw new Error('Choose a different sync leader for this deck.');
    const follower = this.decks[index], master = this.decks[masterIndex];
    if (!follower?.buffer || !master?.buffer) throw new Error('Load both decks first.');
    if (!master.playing) throw new Error('Play the other deck first. Beat sync starts or aligns this deck to it.');
    const when = Math.max(this.ctx.currentTime + .025 + (follower.keyLocked?PITCH_PREROLL:0),master.started+.025);
    if (!master.loop && master.positionAtTime(when) >= master.buffer.duration - .001) throw new Error('The other deck is ending.');
    const plan = syncPlan({followerPosition:follower.positionAtTime(when),followerBpm:followerGrid.bpm,
      followerAnchor:followerGrid.gridAnchor || 0,duration:follower.buffer.duration,loop:follower.loop,
      masterPosition:master.positionAtTime(when),masterBpm:masterGrid.bpm,masterAnchor:masterGrid.gridAnchor || 0,masterRate:master.rateAtTime(when)});
    if (plan.rate < .84 - 1e-9 || plan.rate > 1.16 + 1e-9) throw new Error('Tempo difference exceeds the ±16% range.');
    follower.pause(when); follower.offset = plan.position; follower.rate = plan.rate; follower.play(when);
    return {...plan, when};
  }
}
export class Deck {
  constructor(engine) {
    this.engine = engine; this.ctx = engine.ctx; this.buffer = null; this.source = null;
    this.playing = false; this.offset = 0; this.started = 0; this.rate = 1; this.loop = null;
    this.keyLocked=false;this.pitchBuffer=null;this.voice=null;this.voices=new Set();
    this.bpm=120;
    this.timeline=[{at:0,offset:0,rate:1,loop:null,playing:false}];
    const c = this.ctx;
    this.low = c.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 250;
    this.mid = c.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1000; this.mid.Q.value = 0.7;
    this.high = c.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 4000;
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 20000;
    this.level = c.createGain(); this.level.gain.value = 0.8;
    this.cueSend = c.createGain(); this.cueSend.gain.value = 0; this.cueEnabled = false;
    this.blend = c.createGain(); this.meter = c.createAnalyser(); this.meter.fftSize = 256;
    this.low.connect(this.mid); this.mid.connect(this.high); this.high.connect(this.filter);
    this.fx=new DeckEffects(c);this.filter.connect(this.fx.input);this.fx.output.connect(this.level);this.level.connect(this.meter);this.meter.connect(this.blend);this.blend.connect(engine.master);
    this.fx.output.connect(this.cueSend); this.cueSend.connect(engine.cueBus);
  }
  setCue(enabled) { this.cueEnabled = !!enabled; this.cueSend.gain.setTargetAtTime(enabled ? 1 : 0, this.ctx.currentTime, .015); }
  stateAt(when){for(let i=this.timeline.length-1;i>=0;i--)if(this.timeline[i].at<=when)return this.timeline[i];return this.timeline[0];}
  recordState(at,offset,playing,rate=this.rate,loop=this.loop){this.timeline=this.timeline.filter(s=>s.at<at);this.timeline.push({at,offset,playing,rate,loop:loop?{...loop}:null});if(this.timeline.length>64)this.timeline.splice(0,this.timeline.length-64);}
  rateAtTime(when){return this.stateAt(when).rate;}
  positionAtTime(when) { const state=this.stateAt(when);return this.buffer ? positionAt(state.offset,state.playing?when-state.at:0,state.rate,this.buffer.duration,state.loop) : 0; }
  position() { return this.positionAtTime(this.ctx.currentTime); }
  load(buffer) { this.pause();for(const voice of this.voices){voice.gain.gain.cancelScheduledValues(this.ctx.currentTime);voice.gain.gain.setValueAtTime(0,this.ctx.currentTime);voice.source.stop(this.ctx.currentTime);}this.fx.clear();this.buffer = buffer; this.offset = 0; this.rate = 1; this.loop = null;this.pitchBuffer=this.keyLocked?paddedPitchBuffer(this.ctx,buffer):null;this.recordState(this.ctx.currentTime,0,false); }
  setBpm(bpm){if(!Number.isFinite(bpm)||bpm<=0)throw new Error('Invalid track BPM.');this.bpm=bpm;this.fx.setTiming(bpm*this.rate);}
  async setKeyLock(enabled){
    if(this.playing)throw new Error('Pause this deck before changing key lock.');
    if(enabled)await registerPitch(this.ctx);
    if(this.playing)throw new Error('Pause this deck before changing key lock.');
    if(!this.buffer)throw new Error('Load a track first.');
    this.pitchBuffer=enabled?paddedPitchBuffer(this.ctx,this.buffer):null;this.keyLocked=!!enabled;
  }
  scheduleEnd(voice,at=this.ctx.currentTime){
    if(voice!==this.voice)return;
    const gain=voice.gain.gain;gain.cancelScheduledValues(at);
    gain.setValueAtTime(at<voice.when?0:gain.value,at);
    if(at<voice.when){gain.setValueAtTime(0,voice.when);gain.linearRampToValueAtTime(1,voice.when+.008);}
    else if(at<voice.when+.008)gain.linearRampToValueAtTime(1,voice.when+.008);
    if(this.loop)return;
    const end=at+(this.buffer.duration-this.positionAtTime(at))/this.rateAtTime(at);
    voice.end=end;gain.setValueAtTime(1,Math.max(voice.when+.008,end-.008));gain.linearRampToValueAtTime(0,Math.max(voice.when+.009,end));
    voice.source.stop(end+.025);
  }
  play(when = this.ctx.currentTime) {
    if (!this.buffer || this.playing) return;
    if (this.offset >= this.buffer.duration - 0.001) this.offset = 0;
    const s = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    const latency=this.keyLocked?pitchLatency(this.rate):0,preroll=this.keyLocked?PITCH_PREROLL:0;
    const processor=this.keyLocked?pitchNode(this.ctx,this.rate):null;
    s.buffer = this.keyLocked?this.pitchBuffer:this.buffer; s.playbackRate.value = this.rate;
    const prefix=this.keyLocked?PITCH_PREFIX:0;
    if (this.loop) { s.loop = true; s.loopStart = prefix+this.loop.start; s.loopEnd = prefix+this.loop.end; }
    if(processor){s.connect(processor);processor.connect(gain);}else s.connect(gain);
    gain.connect(this.low);
    when = Math.max(when, this.ctx.currentTime+preroll);
    this.fx.setTiming(this.bpm*this.rate,this.fx.beats,when);
    gain.gain.setValueAtTime(0, this.ctx.currentTime); gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(1, when + 0.008);
    this.source = s; this.sourceGain = gain; this.started = when; this.playing = true;
    const voice={source:s,gain,processor,when};this.voice=voice;this.voices.add(voice);this.recordState(when,this.offset,true);
    if(processor)processor.onprocessorerror=()=>{if(this.voice===voice&&this.ctx.state!=='closed'){this.pause();this.keyLocked=false;this.pitchBuffer=null;this.engine.onError?.(new Error('Key lock stopped because the audio processor failed. This deck is paused; reload or play with key lock off.'));}};
    s.onended = () => {s.disconnect();gain.disconnect();if(processor){processor.disconnect();processor.port.close();}this.voices.delete(voice);if(this.source===s){this.playing=false;this.offset=this.buffer.duration;this.source=null;this.voice=null;this.recordState(this.ctx.currentTime,this.offset,false);}};
    s.start(when-preroll,Math.max(0,prefix+this.offset-(preroll-latency)*this.rate));
    if(processor)this.scheduleEnd(voice,when);
  }
  pause(when = this.ctx.currentTime) {
    when = Math.max(when, this.ctx.currentTime);
    this.offset = this.positionAtTime(when); this.playing = false;
    this.recordState(when,this.offset,false);
    for(const voice of this.voices){voice.gain.gain.cancelScheduledValues(this.ctx.currentTime);voice.gain.gain.setValueAtTime(voice.gain.gain.value,Math.max(this.ctx.currentTime,when-.008));voice.gain.gain.linearRampToValueAtTime(0,when+.008);voice.source.stop(when+.025);}
    this.source=null;this.voice=null;
  }
  seek(position) {
    if (!this.buffer) return;
    const playing = this.playing; this.pause();
    this.offset = Math.max(0, Math.min(this.buffer.duration, position));
    if (this.loop && (this.offset < this.loop.start || this.offset >= this.loop.end)) this.loop = null;
    this.recordState(this.ctx.currentTime,this.offset,false);
    if (playing && this.offset < this.buffer.duration - .001) this.play();
  }
  setRate(rate) {
    if(!Number.isFinite(rate)||rate<.84-1e-9||rate>1.16+1e-9)throw new Error('Tempo is outside the supported ±16% range.');
    if(this.playing&&this.keyLocked&&this.voice?.when>this.ctx.currentTime){const when=this.voice.when,position=this.position();this.pause();this.offset=position;this.rate=rate;this.recordState(this.ctx.currentTime,position,false);this.play(when);return;}
    const rawWhen=this.ctx.currentTime,when=this.playing&&this.keyLocked?Math.max(this.started,rawWhen+pitchLatency(rate)):Math.max(this.started,rawWhen);
    const position=this.positionAtTime(when);this.rate=rate;this.offset=position;this.started=when;
    this.recordState(when,position,this.playing);
    this.fx.setTiming(this.bpm*rate,this.fx.beats,when);
    if (this.source) {this.source.playbackRate.cancelScheduledValues(rawWhen);this.source.playbackRate.setValueAtTime(rate,rawWhen);if(this.voice.processor){const param=this.voice.processor.parameters.get('playbackRate');param.cancelScheduledValues(rawWhen);param.setValueAtTime(rate,rawWhen);this.scheduleEnd(this.voice,when);}}
  }
  setLoop(beats, bpm, anchor = 0) {
    if (!this.buffer) return false;
    const region = beats ? beatLoop(this.position(), bpm, anchor, beats, this.buffer.duration) : null;
    if (beats && !region) return false;
    const playing = this.playing; this.pause();
    this.loop = region;
    if (region) this.offset = Math.max(region.start, Math.min(this.offset, region.end - 1e-6));
    this.recordState(this.ctx.currentTime,this.offset,false);
    if (playing) this.play();
    return true;
  }
}
