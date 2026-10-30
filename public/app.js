import { AudioEngine } from './engine.js';
import { waveform, estimateBpm, synthesize } from './dsp.js';
import { beatPhase, quantizePosition } from './beatgrid.js';
import {mountSampler} from './sampler-ui.js';
import {mountMidi} from './midi-ui.js';
import {DECK_IDS} from './mixer-routing.js';
import {renderMixerLayout} from './mixer-layout.js';
import {mountCrates} from './crates-ui.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const engine = new AudioEngine();
engine.onError=error=>fail(error);
const decks = DECK_IDS.map(id=>({id,track:null,loading:false,taps:[],loops:0}));
renderMixerLayout(document,DECK_IDS);
let tracks = [], view = 'all', sort = 'default', history = new Set(), db = null;
let samplerUI=null,crateUI=null;
let recorder = null, recordStarted = 0, recordingUrl = null, toastTimer, recordLimitTimer, importing = false;
const demos = [
  { id: 'demo-1', title: 'After the last train', artist: 'ORBIT Originals · Deep house', bpm: 120, seed: 1, duration: 32 },
  { id: 'demo-2', title: 'Blue hour radio', artist: 'ORBIT Originals · Night drive', bpm: 124, seed: 2, duration: 64 * 60 / 124 },
  { id: 'demo-3', title: 'Concrete & sunlight', artist: 'ORBIT Originals · Warehouse', bpm: 128, seed: 3, duration: 30 }
];
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = seconds => { const n = Math.max(0, Math.floor(seconds || 0)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
function notify(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500); }
function fail(error) { console.error(error); notify(error.message || 'Something went wrong. Please try again.'); }
function action(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(fail); }

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('orbit-dj', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('tracks', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => reject(new Error('Local library is locked by another tab.'));
  });
}
function dbTask(mode, execute) {
  return new Promise((resolve, reject) => {
    if (!db) { reject(new Error('Local storage unavailable')); return; }
    const tx = db.transaction('tracks', mode), store = tx.objectStore('tracks');
    const request = execute(store);
    tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
function metadata(track) { return { id: track.id, title: track.title, artist: track.artist, bpm: track.bpm, duration: track.duration, seed: track.seed, favorite: !!track.favorite, cues: [...track.cues], gridAnchor:track.gridAnchor || 0, quantize:!!track.quantize, peaks: track.peaks || null, estimated: !!track.estimated, blob: track.blob || null }; }
async function persist(track) {
  if (!db) return;
  try { await dbTask('readwrite', store => store.put(metadata(track))); }
  catch { notify('Browser storage is full or unavailable. Changes remain in this session only.'); }
}
function renderDecks() {
  decks.forEach((d, index) => {
    const letter = d.id.toUpperCase(), root = $('#deck-' + d.id);
    root.innerHTML = `<div class="deck-label"><strong>${letter}<small>DECK ${index + 1}</small></strong><div class="deck-monitor"><button class="pfl" aria-label="Deck ${letter} headphone preview" aria-pressed="false" disabled>PFL</button><span class="deck-state">NO TRACK</span></div></div>
      <div class="track-header"><div><h2 class="deck-title">Room for your next track</h2><p class="track-meta">Load from your collection below</p></div><span class="track-number">${String(index + 1).padStart(2, '0')}</span></div>
      <div class="deck-display"><canvas class="waveform" role="img" aria-label="Deck ${letter} waveform; use position slider to seek"></canvas><div class="waveform-empty">YOUR NEXT TRACK STARTS HERE</div><div class="time-row"><div><span class="elapsed">00:00</span><span class="remaining"> / 00:00</span></div><div class="bpm-box"><span class="bpm-estimate"></span><input class="bpm-input" aria-label="Deck ${letter} original BPM" title="Original BPM; editable. Imported values are estimates." type="number" min="40" max="300" step="0.1" placeholder="—" disabled><label>BPM</label></div></div></div>
      <input class="seek" type="range" min="0" max="100" step="0.01" value="0" aria-label="Deck ${letter} position" disabled>
      <div class="transport"><button class="play" aria-label="Play deck ${letter}" disabled>▶</button><button class="cue-button" aria-label="Return deck ${letter} to start" disabled>CUE</button><button class="tap" aria-label="Tap deck ${letter} BPM" disabled>TAP</button><button class="sync" aria-label="Align deck ${letter} beats to selected sync leader" title="Matches tempo and starts or aligns this deck to the selected SYNC LEADER. One-shot alignment." disabled>BEAT SYNC</button></div>
      <div class="tempo-row"><label for="tempo-${d.id}">TEMPO</label><input id="tempo-${d.id}" class="tempo" aria-label="Deck ${letter} tempo" type="range" min="-16" max="16" step="0.01" value="0" disabled><button class="tempo-reset" aria-label="Reset deck ${letter} tempo" disabled>+0.00%</button><button class="key-lock" aria-label="Deck ${letter} key lock" aria-pressed="false" title="Preserve pitch when changing tempo. Pause before switching. Adds about 90 ms startup preparation." disabled>KEY</button></div>
      <div class="grid-controls"><button class="grid-set" aria-label="Set deck ${letter} first beat here" disabled>SET BEAT 1</button><button class="grid-left" aria-label="Move deck ${letter} grid 10 milliseconds earlier" disabled>−</button><output class="grid-anchor" aria-label="Deck ${letter} grid anchor">0.000s</output><button class="grid-right" aria-label="Move deck ${letter} grid 10 milliseconds later" disabled>＋</button><button class="quantize" aria-label="Deck ${letter} quantize cue placement" aria-pressed="false" disabled>Q</button><output class="beat-readout" aria-label="Deck ${letter} beat phase">—</output></div>
      <div class="pad-heading"><span>HOT CUES</span><span>CLICK TO SET · ⇧ CLEAR</span></div><div class="pads">${Array.from({length:8},(_,i)=>`<button class="pad" data-cue="${i}" aria-label="Deck ${letter} cue ${i+1}: empty" disabled><span>0${i+1}</span><small>＋</small></button>`).join('')}</div>
      <div class="loop-row"><span>↻ LOOP</span>${[1,2,4,8,16].map(n=>`<button class="loop-button" data-beats="${n}" aria-label="Deck ${letter} loop ${n} beats" aria-pressed="false" disabled>${n}</button>`).join('')}<button class="loop-button loop-off" aria-label="Disable deck ${letter} loop" disabled>OFF</button></div>
      <div class="fx-rack"><div class="fx-heading"><span>CHANNEL FX</span><button class="fx-clear" aria-label="Clear deck ${letter} effects" disabled>RESET FX</button></div><div class="fx-row"><label>ECHO</label><input class="fx-echo" type="range" aria-label="Deck ${letter} echo amount" min="0" max="1" step="0.01" value="0" disabled><select class="fx-division" aria-label="Deck ${letter} echo beats" disabled><option value="0.25">¼ beat</option><option value="0.5" selected>½ beat</option><option value="1">1 beat</option><option value="2">2 beats</option></select><output class="fx-time">250ms</output></div><div class="fx-row"><label>ROOM</label><input class="fx-room" type="range" aria-label="Deck ${letter} room amount" min="0" max="1" step="0.01" value="0" disabled><output class="fx-room-value">0%</output></div></div>`;
    d.root = root;
    $('.play', root).onclick = action(() => toggle(index));
    $('.pfl', root).onclick = () => {
      const deck = engine.decks[index]; deck.setCue(!deck.cueEnabled);
      $('.pfl', root).classList.toggle('active', deck.cueEnabled);
      $('.pfl', root).setAttribute('aria-pressed', String(deck.cueEnabled));
      if (deck.cueEnabled && engine.outputMode !== 'split') notify('PFL selected. Choose split cable in Audio settings to hear the headphone preview.');
    };
    $('.cue-button', root).onclick = () => { const deck = engine.decks[index]; deck.pause(); deck.seek(0); d.loops = 0; deck.loop = null; };
    $('.tempo', root).oninput = e => setTempo(index, Number(e.target.value));
    $('.tempo-reset', root).onclick = () => setTempo(index, 0);
    $('.key-lock',root).onclick=action(async()=>{
      const button=$('.key-lock',root);button.disabled=true;d.keyBusy=true;
      try{await engine.decks[index].setKeyLock(!engine.decks[index].keyLocked);button.classList.toggle('active',engine.decks[index].keyLocked);button.setAttribute('aria-pressed',String(engine.decks[index].keyLocked));notify(engine.decks[index].keyLocked?'Key lock on. Tempo changes keep the original pitch.':'Key lock off. Tempo changes also change pitch.');}
      finally{d.keyBusy=false;button.disabled=!d.track||d.loading||engine.decks[index].playing;}
    });
    $('.seek', root).oninput = e => { engine.decks[index].seek(Number(e.target.value)); d.loops = engine.decks[index].loop ? d.loops : 0; };
    $('.waveform', root).onclick = e => { if (d.track && !d.loading) { const rect = e.target.getBoundingClientRect(); engine.decks[index].seek((e.clientX - rect.left) / rect.width * d.track.duration); d.loops = engine.decks[index].loop ? d.loops : 0; } };
    $('.bpm-input', root).onchange = action(async e => {
      const value = Number(e.target.value);
      if (value < 40 || value > 300 || !Number.isFinite(value)) { e.target.value = d.track.bpm || ''; notify('Enter a BPM between 40 and 300.'); return; }
      d.track.bpm = value; d.track.estimated = false; d.taps = []; disableLoopsForTrack(d.track); await persist(d.track); renderLibrary(); refreshTrackBpm(d.track);
    });
    $('.tap', root).onclick = action(async () => {
      const now = performance.now(); if (d.taps.length && now - d.taps.at(-1) > 2000) d.taps = [];
      d.taps.push(now); d.taps = d.taps.slice(-8);
      if (d.taps.length < 3) { notify(`Tap ${3 - d.taps.length} more time(s) to set BPM`); return; }
      const bpm = 60000 * (d.taps.length - 1) / (now - d.taps[0]);
      if (bpm >= 40 && bpm <= 300) { d.track.bpm = Math.round(bpm * 10) / 10; d.track.estimated = false; disableLoopsForTrack(d.track); refreshTrackBpm(d.track); renderLibrary(); await persist(d.track); }
    });
    $('.sync', root).onclick = action(async () => {
      const masterIndex=decks.findIndex(deck=>deck.id===$('#sync-master').value),other=decks[masterIndex];
      if(masterIndex===index){notify('Choose a different sync leader for this deck.');return;}
      if (!other.track?.bpm || !d.track.bpm || d.loading || other.loading) { notify('Load both decks and set their BPM first.'); return; }
      await engine.init();
      const plan=engine.syncTo(index,d.track,other.track,masterIndex),percent=(plan.rate-1)*100;
      $('.tempo',root).value=percent;$('.tempo-reset',root).textContent=`${percent>=0?'+':''}${percent.toFixed(2)}%`;
      history.add(d.track.id);if(view==='history')renderLibrary();
      notify(`Deck ${letter} beats aligned to ${other.id.toUpperCase()}. One-shot sync; repeat after changing tempo or seeking.`);
    });
    async function editGrid(anchor) {
      d.track.gridAnchor=Math.max(0,Math.min(d.track.duration-.001,anchor));
      disableLoopsForTrack(d.track);refreshGrid(d.track);await persist(d.track);
    }
    $('.grid-set',root).onclick=action(()=>editGrid(engine.decks[index].position()));
    $('.grid-left',root).onclick=action(()=>editGrid((d.track.gridAnchor||0)-.01));
    $('.grid-right',root).onclick=action(()=>editGrid((d.track.gridAnchor||0)+.01));
    $('.quantize',root).onclick=action(async()=>{d.track.quantize=!d.track.quantize;refreshGrid(d.track);await persist(d.track);});
    $$('.pad', root).forEach(pad => pad.onclick = action(async e => {
      const i = Number(pad.dataset.cue), deck = engine.decks[index];
      if (e.shiftKey) d.track.cues[i] = null;
      else if (d.track.cues[i] == null) d.track.cues[i] = d.track.quantize ? quantizePosition(deck.position(),d.track.bpm,d.track.gridAnchor||0,d.track.duration) : deck.position();
      else { deck.seek(d.track.cues[i]); if (!deck.loop) d.loops = 0; }
      decks.filter(x => x.track === d.track).forEach(updatePads); await persist(d.track);
    }));
    $$('.loop-button', root).forEach(button => button.onclick = () => {
      if (!d.track.bpm) { notify('Set the original BPM to use beat loops.'); return; }
      const beats = Number(button.dataset.beats || 0),requested=d.loops===beats?0:beats;
      if(!engine.decks[index].setLoop(requested,d.track.bpm,d.track.gridAnchor||0)){notify('Not enough audio left for a complete beat loop. Seek earlier.');return;}
      d.loops=requested;
    });
    for(const selector of ['.fx-echo','.fx-room'])$(selector,root).oninput=()=>applyDeckFx(index);
    $('.fx-division',root).onchange=()=>applyDeckFx(index);
    $('.fx-clear',root).onclick=()=>{$('.fx-echo',root).value=0;$('.fx-room',root).value=0;applyDeckFx(index);engine.decks[index].fx.clear();};
  });
  ['high','mid','low','filter'].forEach(name => decks.forEach((d,i) => {
    const input = $(`#${name}-${d.id}`); input.oninput = () => {
      const value = Number(input.value);
      input.nextElementSibling.textContent = name === 'filter' ? (value === 100 ? 'OPEN' : `${Math.round(40 * 500 ** (value / 100))} Hz`) : `${value} dB`;
      if (!engine.ctx) return;
      const param = name === 'filter' ? engine.decks[i].filter.frequency : engine.decks[i][name].gain;
      param.setTargetAtTime(name === 'filter' ? 40 * 500 ** (value / 100) : value, engine.ctx.currentTime, 0.015);
    };
  }));
}
function refreshTrackBpm(track) { decks.forEach((d,i)=>{if(d.track===track){ $('.bpm-input', d.root).value = track.bpm || ''; $('.bpm-estimate', d.root).textContent = track.estimated ? '~ EST.' : '';engine.decks[i].setBpm(track.bpm||120);applyDeckFx(i);}}); }
function applyDeckFx(index){const d=decks[index];if(!d.track)return;const deck=engine.decks[index],fx=deck.fx;fx.setAmounts(d.track.bpm?Number($('.fx-echo',d.root).value):0,Number($('.fx-room',d.root).value));const beats=Number($('.fx-division',d.root).value);if(beats!==fx.beats)fx.setTiming((d.track.bpm||120)*deck.rate,beats,Math.max(engine.ctx.currentTime,deck.started));$('.fx-room-value',d.root).textContent=`${Math.round(fx.room*100)}%`;}
function refreshGrid(track) { decks.filter(d=>d.track===track).forEach(d=>{ $('.grid-anchor',d.root).textContent=`${(track.gridAnchor||0).toFixed(3)}s`;$('.quantize',d.root).classList.toggle('active',!!track.quantize);$('.quantize',d.root).setAttribute('aria-pressed',String(!!track.quantize)); }); }
function disableLoopsForTrack(track) { decks.forEach((d, i) => { if (d.track === track) { engine.decks[i].setLoop(0, 120); d.loops = 0; } }); }
function setTempo(index, percent) {
  const d = decks[index]; percent = Math.max(-16, Math.min(16, percent));
  engine.decks[index].setRate(1 + percent / 100); $('.tempo', d.root).value = percent;
  $('.tempo-reset', d.root).textContent = `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
}
function updatePads(d) { $$('.pad', d.root).forEach((pad, i) => { const point = d.track.cues[i]; pad.classList.toggle('saved', point != null); $('small', pad).textContent = point == null ? '＋' : time(point); pad.title = point == null ? 'Click to set cue; Shift-click to clear' : `${point.toFixed(3)} seconds · Shift-click to clear`; pad.setAttribute('aria-label', `Deck ${d.id.toUpperCase()} cue ${i+1}: ${point == null ? 'empty' : time(point)}`); }); }
async function loadTrack(track, index) {
  const d = decks[index];
  if (d.loading) return;
  if (engine.decks[index]?.playing) { notify(`Pause deck ${d.id.toUpperCase()} before loading a new track.`); return; }
  d.loading = true;
  $$('button,input,select', d.root).forEach(e => e.disabled = true);
  $('.deck-state', d.root).textContent = 'LOADING';
  try {
    await engine.init();
    // Apply controls changed before the first audio interaction.
    ['high','mid','low','filter'].forEach(name => decks.forEach(x => $(`#${name}-${x.id}`).oninput()));
    decks.forEach((x, i) => engine.decks[i].level.gain.setTargetAtTime(Number($(`#volume-${x.id}`).value), engine.ctx.currentTime, .015));
    const buffer=await decodeTrack(track);
    if (!track.peaks) { track.peaks = waveform(buffer.getChannelData(0)); await persist(track); }
    engine.decks[index].load(buffer); engine.decks[index].setCue(false); d.track = track; d.loops = 0; d.taps = [];
    $('.pfl', d.root).classList.remove('active'); $('.pfl', d.root).setAttribute('aria-pressed', 'false');
    $('.key-lock',d.root).classList.toggle('active',engine.decks[index].keyLocked);$('.key-lock',d.root).setAttribute('aria-pressed',String(engine.decks[index].keyLocked));
    $('.deck-title', d.root).textContent = track.title; $('.track-meta', d.root).textContent = track.artist;
    $('.waveform-empty', d.root).hidden = true;
    $('.seek', d.root).max = buffer.duration; $('.seek', d.root).value = 0;
    setTempo(index, 0); refreshTrackBpm(track); refreshGrid(track); updatePads(d);
    notify(`Loaded “${track.title}” into deck ${d.id.toUpperCase()}`);
  } finally {
    d.loading = false;
    $$('button,input,select', d.root).forEach(e => e.disabled = !d.track);
    $('.deck-state', d.root).textContent = d.track ? 'READY' : 'NO TRACK';
  }
}
async function decodeTrack(track){
  await engine.init();
  if(track.seed){const samples=synthesize(engine.ctx.sampleRate,demos.find(x=>x.id===track.id).bpm,track.seed);const buffer=engine.ctx.createBuffer(1,samples.length,engine.ctx.sampleRate);buffer.copyToChannel(samples,0);return buffer;}
  return engine.ctx.decodeAudioData(await track.blob.arrayBuffer());
}
async function toggle(index) {
  const d = decks[index]; if (!d.track || d.loading) return;
  await engine.init(); const deck = engine.decks[index];
  if (deck.playing) deck.pause(); else { deck.play(); history.add(d.track.id); if (view === 'history') renderLibrary(); }
}
function renderLibrary() {
  const crate=crateUI?.current();if(view.startsWith('crate:')&&!crate)view='all';
  let filtered = (crate?crateUI.ordered(crate):tracks.filter(t => view === 'all' || view === 'favorites' && t.favorite || view === 'demo' && t.seed || view === 'history' && history.has(t.id))).filter(t=>`${t.title} ${t.artist}`.toLowerCase().includes($('#search').value.toLowerCase()));
  if (sort === 'title') filtered.sort((a,b) => a.title.localeCompare(b.title));
  if (sort === 'bpm') filtered.sort((a,b) => (a.bpm || 0) - (b.bpm || 0));
  crateUI?.render({tracks:filtered,sort,query:$('#search').value});
  $('#view-title').textContent=crate?.name||{all:'All tracks',favorites:'Favorites',demo:'Demo collection',history:'Played this session'}[view];
  $$('[data-view]').forEach(button=>button.classList.toggle('selected',button.dataset.view===view));
  $('#sort-title').setAttribute('aria-pressed',String(sort==='title'));$('#sort-bpm').setAttribute('aria-pressed',String(sort==='bpm'));
  $('#tracks').innerHTML = filtered.map((t,i) => `<tr data-track="${escape(t.id)}"><td class="star-col"><button class="favorite-button ${t.favorite?'saved':''}" aria-label="${t.favorite?'Unfavorite':'Favorite'} ${escape(t.title)}" aria-pressed="${!!t.favorite}">${t.favorite?'★':'☆'}</button></td><td class="number-col">${String(i+1).padStart(2,'0')}</td>${crateUI?.rowControls(t)||''}<td><div class="track-cell"><div class="artwork" data-art="${t.seed || 2}">◉</div><div><b>${escape(t.title)}</b><small>${escape(t.artist)}</small></div></div></td><td><span class="source-tag">${t.seed?'ORIGINAL':'LOCAL FILE'}</span></td><td>${t.estimated?'~ ':''}${t.bpm || '—'}</td><td>${time(t.duration)}</td><td>${decks.map((deck,index)=>`<button class="load-button" data-deck="${index}" aria-label="Load ${escape(t.title)} into deck ${deck.id.toUpperCase()}">${deck.id.toUpperCase()}</button>`).join("")}</td></tr>`).join('');
  $('#empty-state').hidden = filtered.length !== 0;
  $('#empty-state').textContent=crate?'No matching songs in this crate. Select songs in All tracks, then use Add selected.':'No tracks here yet. Import music or try another search.';
  $('#track-count').textContent = String(tracks.length).padStart(2,'0'); $('#all-count').textContent = tracks.length;
  $('#library-subtitle').textContent = `${filtered.length} track${filtered.length === 1 ? '' : 's'} · ${db ? 'Saved in this browser' : 'Session only'}`;
  $$('#tracks tr').forEach(row => {
    const track = tracks.find(t => t.id === row.dataset.track);
    $('.favorite-button', row).onclick = action(async () => { track.favorite = !track.favorite; renderLibrary(); await persist(track); });
    $$('.load-button', row).forEach(button => button.onclick = action(() => loadTrack(track, Number(button.dataset.deck))));
  });
  samplerUI?.refreshSources();
}
async function importFiles(files) {
  if (importing) return;
  importing = true; $('#import-button').disabled = true;
  let imported = 0, failed = 0;
  try {
    await engine.init();
    for (const file of files) {
      $('#import-button').textContent = `Importing ${imported + failed + 1}/${files.length}…`;
      try {
        if (file.size > 80 * 1024 * 1024) throw new Error(`${file.name}: maximum file size is 80 MB.`);
        const total = tracks.reduce((n,t) => n + (t.blob?.size || 0),0);
        if (total + file.size > 300 * 1024 * 1024) throw new Error('The local library limit is 300 MB for this first version.');
        const id = `local-${file.name}-${file.size}-${file.lastModified}`;
        if (tracks.some(t=>t.id===id)) { failed++; continue; }
        const buffer = await engine.ctx.decodeAudioData(await file.arrayBuffer());
        const samples = buffer.getChannelData(0);
        const track = { id, title: file.name.replace(/\.[^.]+$/, ''), artist: 'Your local collection', bpm: estimateBpm(samples, buffer.sampleRate), estimated: true, duration: buffer.duration, blob: file, cues: Array(8).fill(null), favorite:false, peaks:waveform(samples) };
        tracks.push(track); await persist(track); imported++; renderLibrary();
      } catch (error) { failed++; notify(error.message.includes('decode') ? `${file.name}: unsupported or damaged audio file.` : error.message); console.warn('Import skipped', file.name, error.message); }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    notify(`Imported ${imported} track${imported===1?'':'s'}${failed ? ` · ${failed} skipped (duplicate, unsupported or over limit)` : ''}.`);
  } finally { importing = false; $('#import-button').disabled = false; $('#import-button').textContent = '＋ Import tracks'; $('#file-input').value = ''; }
}
function drawWave(d, index, audioTime=engine.ctx?.currentTime||0) {
  const canvas = $('.waveform', d.root), width = canvas.clientWidth, height = canvas.clientHeight, ratio = devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  const c = canvas.getContext('2d'); c.setTransform(ratio,0,0,ratio,0,0); c.clearRect(0,0,width,height);
  const color = ['#a9e755','#62bbf4','#edb48b','#bba4f4'][index];
  c.strokeStyle = '#28313b'; c.lineWidth=1;
  for (let i=1;i<8;i++) { c.beginPath();c.moveTo(width*i/8,0);c.lineTo(width*i/8,height);c.stroke(); }
  c.beginPath();c.moveTo(0,height/2);c.lineTo(width,height/2);c.stroke();
  if (!d.track) return;
  const deck = engine.decks[index], pos = deck.positionAtTime(audioTime), fraction = pos / d.track.duration, peaks = d.track.peaks || [];
  if(d.track.bpm){
    const beat=60/d.track.bpm,anchor=d.track.gridAnchor||0,first=Math.ceil(-anchor/beat);
    for(let n=first;n<first+Math.ceil(d.track.duration/beat)+1;n++){const x=(anchor+n*beat)/d.track.duration*width;if(x<0||x>width)continue;c.strokeStyle=n%4===0?'#6d7b8a':'#303b46';c.beginPath();c.moveTo(x,0);c.lineTo(x,height);c.stroke();}
  }
  if (deck.loop) { c.fillStyle = color+'18'; c.fillRect(deck.loop.start/d.track.duration*width,0,(deck.loop.end-deck.loop.start)/d.track.duration*width,height); }
  for (let x=0;x<width;x+=3) {
    const peak = peaks[Math.floor(x / width * peaks.length)] || 0;
    c.fillStyle = x/width < fraction ? color : ['#52693d','#355a73','#715643','#58496f'][index];
    const h = Math.max(1, peak * height * .9); c.fillRect(x, (height-h)/2,2,h);
  }
  d.track.cues.forEach((point, i) => { if (point == null) return; const x=point/d.track.duration*width;c.fillStyle=color;c.fillRect(x,0,1,height);c.font='8px Consolas';c.fillText(String(i+1),x+3,9); });
  c.fillStyle='#f2f7ff';c.fillRect(Math.min(width-1,fraction*width),0,1,height);
}
const meterData = new Uint8Array(256);
function level(analyser) { analyser.getByteTimeDomainData(meterData); let sum=0; for(const n of meterData) sum+=((n-128)/128)**2;return Math.min(1,Math.sqrt(sum/meterData.length)*2); }
function frame() {
  const audioTime=engine.ctx?.currentTime||0;
  decks.forEach((d,i) => {
    drawWave(d,i,audioTime); if (!d.track) return;
    const deck=engine.decks[i], root=d.root, pos=deck.positionAtTime(audioTime);
    $('.fx-echo',root).disabled=!d.track.bpm||d.loading;$('.fx-division',root).disabled=!d.track.bpm||d.loading;$('.fx-time',root).textContent=d.track.bpm?`${Math.round(deck.fx.delay.delayTime.value*1000)}ms`:'SET BPM';$('.fx-echo',root).title=`Echo ${Math.round(deck.fx.echo*100)}%`;
    const keyButton=$('.key-lock',root);keyButton.disabled=deck.playing||d.loading||!!d.keyBusy;keyButton.classList.toggle('active',deck.keyLocked);keyButton.setAttribute('aria-pressed',String(deck.keyLocked));
    $('.beat-readout',root).textContent=d.track.bpm?`${(d.track.bpm*deck.rateAtTime(audioTime)).toFixed(1)} BPM · ${Math.round(beatPhase(pos,d.track.bpm,d.track.gridAnchor||0)*100)}%`:'SET BPM';
    $('.elapsed',root).textContent=time(pos);$('.remaining',root).textContent=` / −${time(d.track.duration-pos)}`;
    if (document.activeElement!==$('.seek',root)) $('.seek',root).value=pos;
    const play=$('.play',root);play.textContent=deck.playing?'Ⅱ':'▶';play.setAttribute('aria-label',`${deck.playing?'Pause':'Play'} deck ${d.id.toUpperCase()}`);play.setAttribute('aria-pressed',String(deck.playing));
    const state=$('.deck-state',root);state.textContent=d.loading?'LOADING':deck.playing?'PLAYING':'READY';state.classList.toggle('playing',deck.playing);
    $$('.loop-button[data-beats]',root).forEach(b=>{const active=d.loops===Number(b.dataset.beats);b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    $(`#vu-${d.id}`).value=level(deck.meter);
  });
  if(engine.ctx) {
    $('#master-meter').value=level(engine.meter);
    const running=engine.ctx.state==='running';
    $('#audio-status').classList.toggle('ready',running);$('#audio-status').lastChild.textContent=running?' AUDIO READY':' AUDIO SUSPENDED';
    $('#status-detail').textContent=`${(engine.ctx.sampleRate/1000).toFixed(1)} kHz · ${Math.round((engine.ctx.baseLatency || 0)*1000)} ms reported base latency · ${engine.outputMode==='split'?'Split: L headphones / R master':'Stereo master'}`;
  }
  if(recorder?.state==='recording') {
    $('#record-label').textContent=`Stop · ${time((performance.now()-recordStarted)/1000)}`;
  }
  samplerUI?.render();
  requestAnimationFrame(frame);
}
$('#record').onclick=action(async()=>{
  if(recorder?.state==='recording') {recorder.stop();return;}
  await engine.init();
  if(!window.MediaRecorder) throw new Error('Recording is not supported in this browser. Try current Chrome.');
  const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime) throw new Error('No supported recording codec. Try current Chrome.');
  const chunks=[]; recorder=new MediaRecorder(engine.recordBus.stream,{mimeType:mime});
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onerror=()=>{notify('Recording failed. Stop and try again.');};
  recorder.onstop=()=>{
    clearTimeout(recordLimitTimer);
    const blob=new Blob(chunks,{type:mime});
    if(recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl=URL.createObjectURL(blob);$('#recording-preview').src=recordingUrl;$('#recording-download').href=recordingUrl;
    $('#recording-download').download=`orbit-mix-${new Date().toISOString().replace(/[:.]/g,'-')}.${mime.includes('ogg')?'ogg':'webm'}`;
    $('#recording-size').textContent=`${time((performance.now()-recordStarted)/1000)} · ${(blob.size/1024/1024).toFixed(2)} MB · ${mime.includes('ogg')?'OGG':'WebM'} / Opus`;
    $('#record').classList.remove('active');$('#record-label').textContent='Record mix';$('#recording-dialog').showModal();
  };
  recorder.start(1000);recordStarted=performance.now();$('#record').classList.add('active');notify('Recording the master output. Click Stop to save your mix.');
  recordLimitTimer=setTimeout(()=>{if(recorder?.state==='recording'){recorder.stop();notify('20 minute recording limit reached. Your mix is ready to save.');}},20*60*1000);
});
$('#close-recording').onclick=()=>{$('#recording-preview').pause();$('#recording-dialog').close();};
$('#recording-dialog').addEventListener('close',()=>$('#recording-preview').pause());
$('#crossfade').oninput=e=>engine.setCrossfade(e.target.value);
$('#center-fade').onclick=()=>{$('#crossfade').value=.5;engine.setCrossfade(.5);};
$('#master').oninput=e=>{engine.setMaster(e.target.value);$('#master-value').textContent=`${Math.round(e.target.value*100)}%`;};
decks.forEach((d,i)=>$(`#assignment-${d.id}`).onchange=e=>engine.setDeckAssignment(i,e.target.value));
decks.forEach((d,i)=>$(`#volume-${d.id}`).oninput=e=>{if(engine.ctx)engine.decks[i].level.gain.setTargetAtTime(Number(e.target.value),engine.ctx.currentTime,.015);});
$('#import-button').onclick=()=>$('#file-input').click();$('#file-input').onchange=action(e=>importFiles([...e.target.files]));
$('#help-button').onclick=()=>$('#guide').showModal();$('#close-guide').onclick=()=>$('#guide').close();
$('#audio-settings-button').onclick=()=>$('#audio-settings').showModal();
$('#close-audio-settings').onclick=()=>$('#audio-settings').close();
$('#output-mode').onchange=e=>{engine.setOutputMode(e.target.value);notify(e.target.value==='split'?'Split output: headphones LEFT, speakers RIGHT.':'Stereo master output restored.');};
$('#cue-level').oninput=e=>{engine.setCueLevel(e.target.value);$('#cue-level-value').textContent=`${Math.round(e.target.value*100)}%`;};
$('#search').oninput=renderLibrary;$('#sort-title').onclick=()=>{sort=sort==='title'?'default':'title';renderLibrary();};$('#sort-bpm').onclick=()=>{sort=sort==='bpm'?'default':'bpm';renderLibrary();};
$$('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;sort='default';renderLibrary();});
document.addEventListener('keydown',action(async e=>{
  if(e.repeat || e.ctrlKey || e.altKey || e.metaKey || ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || document.querySelector('dialog[open]'))return;
  if(['Digit1','Digit2','Digit3','Digit4'].includes(e.code)){e.preventDefault();await toggle(Number(e.code.slice(-1))-1);}
  const sampleIndex=['KeyZ','KeyX','KeyC','KeyV'].indexOf(e.code);if(sampleIndex>=0){e.preventDefault();await samplerUI.trigger(sampleIndex);}
  if(e.code==='Space'){e.preventDefault();engine.decks.forEach(d=>d.pause());samplerUI?.stopAll();}
}));
window.addEventListener('beforeunload',e=>{if(recorder?.state==='recording'){e.preventDefault();e.returnValue='';}});

renderDecks();
samplerUI=mountSampler({engine,getTracks:()=>tracks,decodeTrack,notify,onError:fail});
mountMidi({beforeConnect:()=>engine.init(),notify,onError:fail});
try { db=await openDb(); tracks=await dbTask('readonly',s=>s.getAll()); }
catch { notify('Local storage is unavailable. Your library will last for this session.'); }
for(const demo of demos) if(!tracks.some(t=>t.id===demo.id))tracks.push({...demo,cues:Array(8).fill(null),favorite:false});
tracks.forEach(track=>{track.cues=Array.from({length:8},(_,i)=>track.cues?.[i]??null);});
crateUI=mountCrates({getTracks:()=>tracks,getView:()=>view,setView:value=>{view=value;sort='default';},onChange:renderLibrary,notify,onError:fail});
renderLibrary();requestAnimationFrame(frame);
