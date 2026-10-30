import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {parseRekordboxXml, materializeLibrary, XML_LIMIT} from '../public/rekordbox-xml.js';
class StrictParser extends DOMParser { constructor(){super({onError:level=>{throw new Error(`XML ${level}`);}});} }
const parse = text => parseRekordboxXml(text, StrictParser);
const xml = (tracks, playlists = '') => `<?xml version="1.0"?><DJ_PLAYLISTS Version="1.0.0"><COLLECTION>${tracks}</COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT">${playlists}</NODE></PLAYLISTS></DJ_PLAYLISTS>`;
const track = (extra = '', inner = '') => `<TRACK TrackID="7" Name="Нощ &amp; ден" Artist="Artist" Location="file://localhost/C:/Music/test.wav" TotalTime="32" AverageBpm="120" ${extra}>${inner}</TRACK>`;
test('XML preserves Unicode and entities, beat anchor, hot cues and source metadata', () => {
  const result=parse(xml(track('Tonality="Am"','<TEMPO Inizio="0.25" Bpm="120" Metro="4/4" Battito="1"/><POSITION_MARK Type="0" Num="0" Start="1.5"/><POSITION_MARK Type="4" Num="-1" Start="4" End="8"/>')));
  assert.equal(result.tracks[0].title,'Нощ & ден');assert.equal(result.tracks[0].gridAnchor,.25);
  assert.equal(result.tracks[0].cues[0],1.5);assert.equal(result.tracks[0].rekordbox.attributes.Tonality,'Am');assert.equal(result.tracks[0].rekordbox.marks.length,2);assert.equal(result.warnings.length,1);
});
test('Nested playlists support TrackID and Location keys with stable order', () => {
  const p='<NODE Type="0" Name="Sets"><NODE Type="1" Name="First" KeyType="0"><TRACK Key="7"/><TRACK Key="7"/></NODE><NODE Type="1" Name="Second" KeyType="1"><TRACK Key="file://localhost/C:/Music/test.wav"/></NODE></NODE>';
  const r=parse(xml(track(),p));assert.deepEqual(r.playlists,[{name:'Sets / First',indexes:[0]},{name:'Sets / Second',indexes:[0]}]);
});
test('Same location maps to same local ID across exports, different locations do not collide', async () => {
  const a=await materializeLibrary(parse(xml(track()))),b=await materializeLibrary(parse(xml(track().replace('TrackID="7"','TrackID="20"')))),c=await materializeLibrary(parse(xml(track().replace('test.wav','different.wav'))));
  assert.equal(a.tracks[0].id,b.tracks[0].id);assert.notEqual(a.tracks[0].id,c.tracks[0].id);assert.equal(a.tracks[0].blob,null);
});
test('Malformed XML, DTD, missing collection and oversized documents fail before import', () => {
  for(const value of ['<DJ_PLAYLISTS>','<DJ_PLAYLISTS/>','<!DOCTYPE x><DJ_PLAYLISTS/>','<!ENTITY x SYSTEM "file:///secret"><DJ_PLAYLISTS/>',' '.repeat(XML_LIMIT+1)])assert.throws(()=>parse(value));
});
test('Duplicate tracks and unresolved playlist references fail instead of losing data', () => {
  assert.throws(()=>parse(xml(track()+track())),/Duplicate/);
  assert.throws(()=>parse(xml(track(),'<NODE Type="1" Name="Bad"><TRACK Key="missing"/></NODE>')),/missing track/);
});
test('Invalid locations and invalid numeric metadata fail; out of range BPM is unapplied', () => {
  assert.throws(()=>parse(xml(track().replace('file://localhost/C:/Music/test.wav','https://example.com/a.wav'))),/file URI/);
  assert.throws(()=>parse(xml(track().replace('AverageBpm="120"','AverageBpm="NaN"'))),/Invalid/);
  const r=parse(xml(track().replace('AverageBpm="120"','AverageBpm="500"')));assert.equal(r.tracks[0].bpm,null);assert.ok(r.warnings.length);
});
test('Dynamic beatgrids survive as source data without a misleading fixed anchor', () => {
  const r=parse(xml(track('','<TEMPO Inizio="1" Bpm="120" Metro="4/4"/><TEMPO Inizio="12" Bpm="125" Metro="4/4"/>')));
  assert.equal(r.tracks[0].gridAnchor,0);assert.equal(r.tracks[0].rekordbox.tempos.length,2);assert.equal(r.warnings.length,1);
});
test('Empty collections are valid and deep folder nesting is bounded',()=>{
  assert.deepEqual(parse(xml('')).tracks,[]);
  assert.throws(()=>parse(xml(track(),'<NODE Type="0" Name="X">'.repeat(35)+'</NODE>'.repeat(35))),/deeply/);
});
