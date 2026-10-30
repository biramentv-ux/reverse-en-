import './app.js';
import {MidiRouter} from './midi-router.js';
import {midiTargets} from './midi-targets.js';
const $=s=>document.querySelector(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await wait(50);}throw new Error('UI update timed out');}
$('#run-midi-qa').onclick=async()=>{
  const results=[],button=$('#run-midi-qa'),master=$('#master'),previous=master.value;button.disabled=true;
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const test=async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}$('#midi-qa-results').textContent=JSON.stringify({synthetic:true,hardwareTested:false,passed:results.filter(r=>r.pass).length,total:results.length,results},null,2);};
  const router=new MidiRouter(midiTargets(document)),device={id:'qa-synthetic',name:'QA synthetic input'};
  function map(target,number,type='cc',mode='absolute',extra={}){router.importText(JSON.stringify({format:'orbit-midi',version:1,mappings:[{deviceId:device.id,deviceName:device.name,type,channel:0,number,target,mode,pickup:false,invert:false,step:0.01,...extra}]}));}
  const send=(status,number,value)=>router.handle(device,[status,number,value]);
  master.value='0';master.dispatchEvent(new Event('input',{bubbles:true}));
  try{
    await test('Every MIDI target resolves a real studio control',()=>{for(const t of midiTargets(document)){assert(t.exists()&&(t.kind==='button'||Number.isFinite(t.get())),t.id);}});
    await test('CC reaches real crossfader input handler',()=>{map('mix.crossfade',7);send(0xb0,7,0);assert($('#crossfade').value==='0','Left endpoint');send(0xb0,7,127);assert($('#crossfade').value==='1','Right endpoint');$('#center-fade').click();});
    await test('Disabled unloaded deck ignores play',()=>{map('deck.a.play',36,'note','button');assert(send(0x90,36,127).kind==='unavailable','Disabled play accepted');});
    await test('Load original demo through studio library',async()=>{$('#tracks [data-deck="0"]').click();await until(()=>!$('#deck-a .play').disabled);assert($('#deck-a .deck-state').textContent==='READY','Deck not ready');});
    await test('Note press plays once; release does not toggle; second press pauses',async()=>{map('deck.a.play',36,'note','button');send(0x90,36,127);await until(()=>$('#deck-a .deck-state').textContent==='PLAYING');send(0x90,36,127);send(0x80,36,0);assert($('#deck-a .play').getAttribute('aria-label').includes('Pause'),'Release toggled play');send(0x90,36,127);await until(()=>$('#deck-a .deck-state').textContent!=='PLAYING');});
    await test('Pitch bend reaches actual tempo and display',()=>{map('deck.a.tempo',0,'pitchbend');send(0xe0,127,127);assert($('#deck-a .tempo').value==='16','Tempo range');assert($('#deck-a .tempo-reset').textContent==='+16.00%','Tempo label');$('#deck-a .tempo-reset').click();});
    await test('FX MIDI input updates actual room display; mapped reset clears it',()=>{map('deck.a.room',9);send(0xb0,9,127);assert($('#deck-a .fx-room-value').textContent==='100%','FX display');map('deck.a.fxReset',37,'note','button');send(0x90,37,127);assert($('#deck-a .fx-room').value==='0','Reset failed');});
    await test('PFL button follows press edges and actual aria state',()=>{map('deck.a.pfl',38,'note','button');send(0x90,38,127);assert($('#deck-a .pfl').getAttribute('aria-pressed')==='true','PFL off');send(0x80,38,0);send(0x90,38,127);assert($('#deck-a .pfl').getAttribute('aria-pressed')==='false','PFL on');});
    await test('Sampler volume MIDI updates actual sampler label',()=>{const old=$('#sampler-volume').value;map('sampler.volume',10);send(0xb0,10,127);assert($('#sampler-volume-value').textContent==='100%','Sampler label');$('#sampler-volume').value=old;$('#sampler-volume').dispatchEvent(new Event('input',{bubbles:true}));});
    await test('Load distinct tracks into C and D through the four-deck library',async()=>{$('#tracks tr:nth-child(3) [data-deck="2"]').click();await until(()=>!$('#deck-c .play').disabled);$('#tracks tr:nth-child(2) [data-deck="3"]').click();await until(()=>!$('#deck-d .play').disabled);assert($('#deck-c .deck-title').textContent!==$('#deck-d .deck-title').textContent,'Track slots not independent');});
    await test('MIDI starts C and syncs D to the selected C leader',async()=>{$('#sync-master').value='c';map('deck.c.play',40,'note','button');send(0x90,40,127);await until(()=>$('#deck-c .deck-state').textContent==='PLAYING');map('deck.d.sync',41,'note','button');send(0x90,41,127);await until(()=>$('#deck-d .deck-state').textContent==='PLAYING');assert(Math.abs(Number($('#deck-d .tempo').value)-3.2258)<.01,'D did not match C BPM');});
    await test('Keyboard Space pauses all four deck transports',async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));await until(()=>[...document.querySelectorAll('.deck-state')].every(e=>e.textContent!=='PLAYING'));});
  }finally{if($('#deck-a .deck-state').textContent==='PLAYING'){$('#deck-a .play').click();await until(()=>$('#deck-a .deck-state').textContent!=='PLAYING');}master.value=previous;master.dispatchEvent(new Event('input',{bubbles:true}));button.disabled=false;}
};

