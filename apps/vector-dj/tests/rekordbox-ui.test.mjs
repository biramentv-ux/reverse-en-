import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRekordbox} from '../public/rekordbox-ui.js';
import {domFixture,xml,setFiles} from './helpers/dom.mjs';
test('XML preview is safe text, validates before import and sends complete materialized data',async t=>{
  const {$}=await domFixture(t,'<section class="library"></section>');let received;
  mountRekordbox({getTracks:()=>[],importLibrary:async value=>{received=value;return 'Saved';},linkAudio:async()=>{}});
  assert.equal($('#rb-import').disabled,true);assert.equal($('#rb-audio').disabled,true);
  $('#rb-toggle').click();assert.equal($('#rb-paste').hidden,false);$('#rb-toggle').click();assert.equal($('#rb-paste').hidden,true);
  $('#rb-text').value='<bad';$('#rb-preview').click();assert.equal($('#rb-import').disabled,true);assert.match($('#rb-summary').textContent,/valid/);
  $('#rb-text').value=xml;$('#rb-preview').click();assert.equal($('#rb-import').disabled,false);assert.match($('#rb-summary').textContent,/1 tracks · 1 playlists/);
  await $('#rb-import').onclick();assert.equal(received.tracks[0].title,'Тест & сет');assert.equal(received.tracks[0].cues[0],1);assert.equal(received.playlists[0].trackIds[0],received.tracks[0].id);assert.equal($('#rb-summary').textContent,'Saved');assert.equal($('#rb-import').disabled,true);
});
test('XML import locks concurrent actions and failed storage remains retryable',async t=>{
  const {$}=await domFixture(t,'<section class="library"></section>');let finish,calls=0;
  mountRekordbox({getTracks:()=>[],importLibrary:async()=>{calls++;return new Promise((_,reject)=>{finish=reject;});},linkAudio:async()=>{}});
  await $('#rb-import').onclick();assert.equal(calls,0);
  $('#rb-text').value=xml;$('#rb-preview').click();const pending=$('#rb-import').onclick();
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  assert.equal($('#rb-file').disabled,true);await $('#rb-import').onclick();assert.equal(calls,1);finish(new Error('Quota exceeded'));await pending;
  assert.match($('#rb-summary').textContent,/Quota exceeded/);assert.equal($('#rb-file').disabled,false);assert.equal($('#rb-import').disabled,false);
});
test('File imports reject oversized or unreadable XML and display unsupported marks',async t=>{
  const {$}=await domFixture(t,'<section class="library"></section>');
  mountRekordbox({getTracks:()=>[],importLibrary:async()=>'',linkAudio:async()=>''});
  setFiles($('#rb-file'),[]);await $('#rb-file').onchange({target:$('#rb-file')});
  for(const file of [{size:11*1024*1024},{size:1,text:async()=>{throw new Error('Read failed');}},{size:xml.length,text:async()=>xml.replace('</TRACK>','<POSITION_MARK Type="4" Num="-1" Start="2" End="4"/></TRACK>')}]){
    setFiles($('#rb-file'),[file]);await $('#rb-file').onchange({target:$('#rb-file')});
  }
  assert.equal($('#rb-warnings').children.length,1);assert.equal($('#rb-import').disabled,false);
});
test('Missing audio selection, linking errors, successful linking and selection retention',async t=>{
  const {$}=await domFixture(t,'<section class="library"></section>');
  const tracks=[{id:'one',title:'<img src=x>',artist:'A',location:'file:///one.wav',rekordbox:{}},{id:'two',title:'Second',artist:'B',location:'file:///two.wav',rekordbox:{}}];let fail=true,calls=0;
  const ui=mountRekordbox({getTracks:()=>tracks,importLibrary:async()=>'',linkAudio:async(id,file)=>{calls++;if(fail)throw new Error('Wrong file');tracks.find(t=>t.id===id).blob=file;return 'Linked';}});
  assert.equal($('#rb-track').querySelector('img'),null);$('#rb-track').value='two';$('#rb-track').onchange();assert.equal($('#rb-location').textContent,'file:///two.wav');ui.refresh();assert.equal($('#rb-track').value,'two');
  setFiles($('#rb-audio'),[]);await $('#rb-audio').onchange({target:$('#rb-audio')});assert.equal(calls,0);
  setFiles($('#rb-audio'),[{name:'track.wav'}]);await $('#rb-audio').onchange({target:$('#rb-audio')});assert.equal($('#rb-link-status').textContent,'Wrong file');assert.equal($('#rb-audio').disabled,false);
  fail=false;await $('#rb-audio').onchange({target:$('#rb-audio')});assert.equal($('#rb-link-status').textContent,'Linked');assert.equal($('#rb-track').value,'one');
  tracks[0].blob={};ui.refresh();assert.equal($('#rb-audio').disabled,true);
});
