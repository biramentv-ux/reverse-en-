import {CrateStore,CRATE_KEY,crateTracks,withCrateLock} from './crate-store.js';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountCrates({getTracks,getView,setView,onChange,notify,onError}){
  const $=s=>document.querySelector(s),selected=new Set();let store,visible=[],canReorder=false,editing=null,url=null,rowCrate=null;
  try{store=new CrateStore(localStorage);}catch{store=new CrateStore();notify('Crates storage is unavailable or invalid. Crates in this session will not be saved.');}
  const bar=document.createElement('div');bar.className='crate-bar';bar.innerHTML='<label>LIBRARY VIEW<select id="crate-view" aria-label="Library view"></select></label><button id="crate-new">＋ New crate</button><button id="crate-manage" disabled>Manage crate</button><button id="crate-backup">Backup crates</button>';
  $('.library-toolbar').after(bar);
  const order=document.createElement('button');order.id='crate-order';order.textContent='Crate order';order.hidden=true;bar.append(order);
  const actions=document.createElement('div');actions.className='crate-actions';actions.hidden=true;actions.innerHTML='<strong id="crate-selection-count" role="status">0 selected</strong><select id="crate-destination" aria-label="Destination crate"></select><button id="crate-add">Add selected</button><button id="crate-remove">Remove from crate</button><button id="crate-clear-selection">Clear selection</button>';
  bar.after(actions);const hint=document.createElement('p');hint.id='crate-hint';hint.className='crate-hint';actions.after(hint);
  const nav=document.createElement('div');nav.id='crate-nav';$('.library aside nav').after(nav);
  const head=document.createElement('th');head.className='select-col';head.innerHTML='<input id="crate-select-visible" type="checkbox" aria-label="Select visible tracks">';$('.library th.number-col').after(head);
  const dialog=document.createElement('dialog');dialog.id='crate-dialog';dialog.setAttribute('aria-labelledby','crate-dialog-title');dialog.innerHTML='<div class="dialog-header"><p class="eyebrow">YOUR NEXT SET</p><button id="crate-close" aria-label="Close crate editor">×</button></div><h2 id="crate-dialog-title">New crate</h2><form id="crate-form"><label class="crate-name-label">CRATE NAME<input id="crate-name" aria-label="Crate name" maxlength="60" required autocomplete="off"></label><p id="crate-error" role="status"></p><div class="crate-dialog-actions"><button type="submit" class="import-button">Save crate</button><button type="button" id="crate-delete" hidden>Delete crate</button></div></form><p class="guide-note">A crate stores an ordered list of songs. Removing a song or deleting a crate keeps the audio in your main library.</p>';
  document.body.append(dialog);
  const backup=document.createElement('dialog');backup.id='crate-backup-dialog';backup.setAttribute('aria-labelledby','crate-backup-title');backup.innerHTML='<div class="dialog-header"><p class="eyebrow">TAKE YOUR SET LIST WITH YOU</p><button id="crate-backup-close" aria-label="Close crates backup">×</button></div><h2 id="crate-backup-title">Crates backup</h2><p class="guide-note">JSON contains crate names, song references and order. It does not contain audio. Restore the audio library separately on another browser. Imports merge crates by ID; an imported crate with an existing ID updates that crate. Other crates are kept.</p><button id="crate-export">Download crates JSON</button><label class="crate-name-label">PASTE A BACKUP<textarea id="crate-json" aria-label="Crates JSON" placeholder="Paste ORBIT crates JSON"></textarea></label><p id="crate-backup-feedback" role="status"></p><button id="crate-import" class="import-button">Import crates</button>';
  document.body.append(backup);
  function current(){return store.snapshot().crates.find(c=>getView()===`crate:${c.id}`)||null;}
  function report(error){$('#crate-error').textContent=error.message;$('#crate-backup-feedback').textContent=error.message;onError(error);}
  const safe=fn=>(...args)=>{try{return Promise.resolve(fn(...args)).catch(report);}catch(error){report(error);}};
  function selectView(value){setView(value);onChange();}
  function selectionState(){
    const known=new Set(getTracks().map(t=>t.id));for(const id of selected)if(!known.has(id))selected.delete(id);
    actions.hidden=selected.size===0;$('#crate-selection-count').textContent=`${selected.size} selected`;
    $('#crate-add').disabled=selected.size===0||!$('#crate-destination').value;$('#crate-remove').disabled=!current()?.trackIds.some(id=>selected.has(id));
    const box=$('#crate-select-visible'),count=visible.filter(t=>selected.has(t.id)).length;box.checked=visible.length>0&&count===visible.length;box.indeterminate=count>0&&count<visible.length;box.disabled=visible.length===0;
  }
  function render({tracks,sort,query}){
    visible=tracks;const crates=store.snapshot().crates,crate=current(),destination=$('#crate-destination').value;rowCrate=crate;canReorder=!!crate&&sort==='default'&&!query.trim();$('#crate-order').hidden=!crate;
    const view=$('#crate-view');view.replaceChildren();
    for(const [value,label] of [['all','All tracks'],['favorites','Favorites'],['history','Played this session'],['demo','Demo collection'],...crates.map(c=>[`crate:${c.id}`,c.name])]){const option=document.createElement('option');option.value=value;option.textContent=label;view.append(option);}view.value=getView();
    $('#crate-manage').disabled=!crate;$('#crate-destination').replaceChildren();
    for(const c of crates){const option=document.createElement('option');option.value=c.id;option.textContent=c.name;$('#crate-destination').append(option);}if(crates.some(c=>c.id===destination))$('#crate-destination').value=destination;
    nav.replaceChildren();if(crates.length){const title=document.createElement('h3');title.textContent='YOUR CRATES';nav.append(title);}
    for(const c of crates){const button=document.createElement('button');button.className='nav-item'+(crate?.id===c.id?' selected':'');button.setAttribute('aria-label',`Open crate ${c.name}`);const name=document.createElement('span'),count=document.createElement('span');name.textContent=c.name;count.textContent=crateTracks(c,getTracks()).length;button.append(name,count);button.onclick=()=>selectView(`crate:${c.id}`);nav.append(button);}
    const missing=crate?crate.trackIds.length-crateTracks(crate,getTracks()).length:0;
    hint.hidden=!crate;hint.textContent=crate?`${store.storage?'Saved in this browser':'Session only'} · ${crate.trackIds.length} song reference${crate.trackIds.length===1?'':'s'}${missing?` · ${missing} audio file${missing===1?' is':'s are'} unavailable in this library`:''} · ${canReorder?'Use ↑ / ↓ to arrange your set.':'Clear search and choose Crate order to rearrange.'}`:'';
    selectionState();
  }
  function rowControls(track){const crate=rowCrate,index=crate?.trackIds.indexOf(track.id)??-1;return `<td class="select-col"><div class="crate-row-tools"><input class="track-select" type="checkbox" aria-label="Select ${escape(track.title)}" ${selected.has(track.id)?'checked':''}>${crate?`<button class="crate-move" data-crate-move="-1" aria-label="Move ${escape(track.title)} up" ${!canReorder||index<=0?'disabled':''}>↑</button><button class="crate-move" data-crate-move="1" aria-label="Move ${escape(track.title)} down" ${!canReorder||index===crate.trackIds.length-1?'disabled':''}>↓</button>`:''}</div></td>`;}
  $('#tracks').addEventListener('change',event=>{if(!event.target.matches('.track-select'))return;const id=event.target.closest('tr').dataset.track;if(event.target.checked)selected.add(id);else selected.delete(id);selectionState();});
  $('#tracks').addEventListener('click',safe(async event=>{const button=event.target.closest('[data-crate-move]');if(!button||button.disabled||!canReorder)return;const id=button.closest('tr').dataset.track,direction=button.dataset.crateMove,crateId=current().id;await withCrateLock(()=>store.move(crateId,id,Number(direction)));onChange();const row=[...$('#tracks').rows].find(row=>row.dataset.track===id);row?.querySelector(`[data-crate-move="${direction}"]`)?.focus();}));
  $('#crate-select-visible').onchange=event=>{for(const track of visible)if(event.target.checked)selected.add(track.id);else selected.delete(track.id);onChange();};
  $('#crate-view').onchange=event=>selectView(event.target.value);$('#crate-destination').onchange=selectionState;
  $('#crate-order').onclick=()=>{$('#search').value='';selectView(getView());};
  $('#crate-clear-selection').onclick=()=>{selected.clear();onChange();};
  $('#crate-add').onclick=safe(async()=>{const id=$('#crate-destination').value,known=new Set(getTracks().map(t=>t.id)),ids=[...selected].filter(id=>known.has(id));await withCrateLock(()=>store.addTracks(id,ids));selected.clear();onChange();notify('Songs added to the crate.');});
  $('#crate-remove').onclick=safe(async()=>{const id=current().id,ids=[...selected];await withCrateLock(()=>store.removeTracks(id,ids));selected.clear();onChange();notify('Songs removed from this crate. Audio stays in your library.');});
  function edit(crate){editing=crate?.id||null;$('#crate-dialog-title').textContent=crate?'Manage crate':'New crate';$('#crate-name').value=crate?.name||'';$('#crate-error').textContent='';$('#crate-delete').hidden=!crate;dialog.showModal();$('#crate-name').focus();}
  $('#crate-new').onclick=()=>edit(null);$('#crate-manage').onclick=()=>edit(current());$('#crate-close').onclick=()=>dialog.close();
  $('#crate-form').onsubmit=safe(async event=>{event.preventDefault();const id=editing,name=$('#crate-name').value,result=await withCrateLock(()=>{if(id){store.rename(id,name);return id;}return store.create(name);});setView(`crate:${result}`);dialog.close();onChange();});
  $('#crate-delete').onclick=safe(async()=>{const id=editing;await withCrateLock(()=>store.remove(id));setView('all');dialog.close();onChange();notify('Crate deleted. Your songs are still in All tracks.');});
  $('#crate-backup').onclick=()=>{$('#crate-backup-feedback').textContent='';backup.showModal();};$('#crate-backup-close').onclick=()=>backup.close();
  $('#crate-export').onclick=safe(()=>{if(store.storage)store.refresh();if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([store.exportText()],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='orbit-crates.json';a.click();});
  $('#crate-import').onclick=safe(async()=>{const text=$('#crate-json').value;$('#crate-backup-feedback').textContent='Importing crates…';await withCrateLock(()=>store.importText(text));onChange();$('#crate-backup-feedback').textContent='Crates imported. Audio files were not included.';});
  window.addEventListener('storage',safe(event=>{if(store.storage&&(event.key===CRATE_KEY||event.key===null)){store.refresh();onChange();}}));
  window.addEventListener('pagehide',()=>{if(url)URL.revokeObjectURL(url);});
  return {current,render,rowControls,ordered:crate=>crateTracks(crate,getTracks())};
}
