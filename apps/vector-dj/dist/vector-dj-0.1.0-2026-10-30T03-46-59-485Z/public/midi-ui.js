import {MidiRouter,parseMidi} from './midi-router.js';
import {MidiConnection} from './midi-connection.js';
import {midiTargets} from './midi-targets.js';
export function mountMidi({beforeConnect,notify,onError}){
  const $=s=>document.querySelector(s),targets=midiTargets(document),byId=new Map(targets.map(t=>[t.id,t]));let lastPaint=0,exportUrl=null;
  const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>{ $('#midi-feedback').textContent=error.message;onError(error);renderConnection();});
  const router=new MidiRouter(targets,{onMappings:()=>{save();renderMappings();renderLearn();},onResult:result=>{
    const name=byId.get(result.target)?.label||'';
    if(result.kind==='learned'){$('#midi-feedback').textContent=`Mapped ${name}. The learning message did not change the control.`;renderLearn();}
    if(result.kind==='learn-wait')$('#midi-feedback').textContent='Use a button for an action, or move a CC / pitch-bend control for a fader.';
    if(result.kind==='pickup')$('#midi-feedback').textContent=`Soft takeover: move ${name} through ${Math.round(result.software*100)}%.`;
    if(result.kind==='unavailable')$('#midi-feedback').textContent=`${name} is unavailable. Load or pause the deck as needed.`;
    if(result.kind==='applied'&&performance.now()-lastPaint>32){$('#midi-feedback').textContent=`${name}${result.value===undefined?'':` · ${Math.round(result.value*100)}%`}`;lastPaint=performance.now();}
  }});
  const connection=new MidiConnection({onMessage:(device,data)=>{
    try{const parsed=parseMidi(data);if(parsed&&performance.now()-lastPaint>32)$('#midi-last').textContent=`CH ${parsed.channel+1} · ${parsed.type==='pitchbend'?'Pitch bend':`${parsed.type.toUpperCase()} ${parsed.number}`} · ${parsed.raw}`;router.handle(device,data);}catch(error){onError(error);}
  },onChange:renderConnection,onReset:id=>{router.resetInput(id);renderLearn();},onError});
  const groups=new Map();for(const target of targets){if(!groups.has(target.group)){const group=document.createElement('optgroup');group.label=target.group;groups.set(target.group,group);$('#midi-target').append(group);}const option=document.createElement('option');option.value=target.id;option.textContent=target.label;groups.get(target.group).append(option);}
  function save(){try{localStorage.setItem('vector-midi-mapping',router.exportText());}catch{notify('MIDI mapping is available for this session; browser storage is unavailable.');}}
  function renderMappings(){
    const body=$('#midi-mappings');body.replaceChildren();
    router.mappings.forEach((mapping,index)=>{
      const row=document.createElement('tr'),target=byId.get(mapping.target);
      const cells=[mapping.deviceName,`CH ${mapping.channel+1} · ${mapping.type==='pitchbend'?'Pitch bend':`${mapping.type.toUpperCase()} ${mapping.number}`}`,target.label,mapping.mode==='button'?'Press':mapping.mode==='absolute'?(mapping.pickup?'Absolute · pickup':'Absolute'):mapping.mode==='relative-twos'?'Relative · 2’s comp.':'Relative · offset'];
      for(const value of cells){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
      const cell=document.createElement('td'),remove=document.createElement('button');remove.textContent='Remove';remove.setAttribute('aria-label',`Remove mapping ${target.label}`);remove.onclick=()=>router.remove(index);cell.append(remove);row.append(cell);body.append(row);
    });
    $('#midi-empty').hidden=router.mappings.length!==0;$('#midi-count').textContent=`${router.mappings.length} mapped control${router.mappings.length===1?'':'s'}`;
  }
  function renderLearn(){
    const continuous=byId.get($('#midi-target').value)?.kind==='continuous',relative=$('#midi-mode').value!=='absolute';
    $('#midi-mode').disabled=!continuous;$('#midi-invert').disabled=!continuous;$('#midi-pickup').disabled=!continuous||relative;$('#midi-step').disabled=!continuous||!relative;
    $('#midi-learn').disabled=!connection.port||connection.selecting;$('#midi-learn').textContent=router.learning?'Listening…':'Learn control';$('#midi-cancel-learn').disabled=!router.learning;
  }
  function renderConnection(){
    const state=connection.snapshot(),select=$('#midi-input');select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.disabled=true;empty.textContent=state.inputs.length?'Choose an input':'No MIDI inputs';select.append(empty);
    for(const input of state.inputs){const option=document.createElement('option');option.value=input.id;option.textContent=input.name;select.append(option);}select.value=state.selectedId;
    select.disabled=!state.connected||!state.inputs.length||state.selecting;
    $('#midi-connect').disabled=state.pending||state.connected;$('#midi-disconnect').disabled=!state.pending&&!state.connected;$('#midi-retarget').disabled=!state.selectedId;
    $('#midi-status').textContent=state.pending?'Waiting for browser MIDI access…':state.selecting?'Opening selected MIDI input…':state.selectedId?'Receiving from selected MIDI input':state.connected?`Access ready · ${state.inputs.length} input${state.inputs.length===1?'':'s'} available`:'Not connected';
    $('#midi-indicator').textContent=state.pending?'WAIT':state.selectedId?'ON':'OFF';$('#midi-button').classList.toggle('active',!!state.selectedId);renderLearn();
  }
  async function support(){
    if(!globalThis.isSecureContext){$('#midi-permission').textContent='MIDI needs a secure page or loopback address.';$('#midi-connect').disabled=true;return;}
    if(!navigator.requestMIDIAccess){$('#midi-permission').textContent='Web MIDI is unavailable. Try current Chrome.';$('#midi-connect').disabled=true;return;}
    try{const status=await navigator.permissions.query({name:'midi',sysex:false});$('#midi-permission').textContent={granted:'Browser permission is granted.',prompt:'Connect will ask for browser permission.',denied:'Browser permission is blocked. Change it in site settings if you want to connect.'}[status.state]||'Browser permission will be checked on Connect.';}catch{$('#midi-permission').textContent='Browser permission will be checked on Connect.';}
  }
  $('#midi-button').onclick=()=>{$('#midi-dialog').showModal();support().catch(onError);};$('#close-midi').onclick=()=>$('#midi-dialog').close();
  $('#midi-connect').onclick=safe(async()=>{$('#midi-connect').disabled=true;await beforeConnect();await connection.connect();await support();});
  $('#midi-disconnect').onclick=safe(async()=>{router.cancelLearn();await connection.disconnect();$('#midi-feedback').textContent='MIDI disconnected. Your mapping is kept.';});
  $('#midi-input').onchange=safe(async event=>{if(event.target.value)await connection.select(event.target.value);});
  $('#midi-target').onchange=$('#midi-mode').onchange=()=>{router.cancelLearn();renderLearn();};
  $('#midi-learn').onclick=safe(()=>{if(!connection.port)return;if(!$('#midi-step').disabled&&!$('#midi-step').checkValidity())throw new Error('Encoder step must be between 0.1% and 10%.');router.learn($('#midi-target').value,{mode:$('#midi-mode').value,pickup:$('#midi-pickup').checked,invert:$('#midi-invert').checked,step:$('#midi-step').disabled?.01:Number($('#midi-step').value)/100});$('#midi-feedback').textContent='Touch the physical control to map it. No action will run during capture.';renderLearn();});
  $('#midi-cancel-learn').onclick=()=>{router.cancelLearn();$('#midi-feedback').textContent='Learning canceled.';renderLearn();};
  $('#midi-export').onclick=()=>{if(exportUrl)URL.revokeObjectURL(exportUrl);exportUrl=URL.createObjectURL(new Blob([router.exportText()],{type:'application/json'}));const link=document.createElement('a');link.href=exportUrl;link.download='vector-midi-mapping.json';link.click();};
  $('#midi-import').onclick=safe(()=>{const selected=connection.inputs().find(input=>input.id===connection.port?.id);if($('#midi-retarget').checked&&!selected)throw new Error('Select a connected MIDI input before retargeting.');router.importText($('#midi-json').value,$('#midi-retarget').checked?selected:null);$('#midi-feedback').textContent='Mapping imported and saved in this browser.';});
  try{const stored=localStorage.getItem('vector-midi-mapping');if(stored)router.importText(stored);}catch{notify('Saved MIDI mapping could not be loaded. Connect and learn controls again.');}
  renderMappings();renderConnection();window.addEventListener('pagehide',()=>{connection.disconnect().catch(onError);if(exportUrl)URL.revokeObjectURL(exportUrl);});
  return {disconnect:()=>connection.disconnect()};
}

