export function mountSampler({engine,getTracks,decodeTrack,notify,onError}){
  const $=s=>document.querySelector(s),pads=[...document.querySelectorAll('.sample-pad')];
  let assignments=Array(4).fill(null),epoch=0,formInitialized=false;const generations=[0,0,0,0],busy=[false,false,false,false],loadedKeys=Array(4).fill(''),signatures=Array(4).fill('');
  const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(onError);
  const key=a=>a?`${a.trackId}|${a.start}|${a.duration}`:'';
  try{
    const saved=JSON.parse(localStorage.getItem('vector-sampler-state')||'null');
    if(saved?.slots)assignments=Array.from({length:4},(_,i)=>{const a=saved.slots[i];return a&&typeof a.trackId==='string'&&Number.isFinite(a.start)&&a.start>=0&&Number.isFinite(a.duration)&&a.duration>=.05&&a.duration<=30?{trackId:a.trackId,start:a.start,duration:a.duration}:null;});
    if(Number.isFinite(saved?.volume)&&saved.volume>=0&&saved.volume<=1)$('#sampler-volume').value=saved.volume;
    if(['master','headphones'].includes(saved?.route))$('#sampler-route').value=saved.route;
  }catch{/* Session defaults remain available when browser storage is blocked. */}
  function save(){try{localStorage.setItem('vector-sampler-state',JSON.stringify({slots:assignments,volume:Number($('#sampler-volume').value),route:$('#sampler-route').value}));}catch{notify('Sampler settings remain in this session; browser storage is unavailable.');}}
  function apply(){if(!engine.sampler)return;engine.sampler.setVolume(Number($('#sampler-volume').value));engine.sampler.setRoute($('#sampler-route').value);}
  function showAssignment(){const a=assignments[Number($('#sample-target').value)];if(a){$('#sample-source').value=a.trackId;$('#sample-start').value=a.start;$('#sample-length').value=a.duration;}}
  function refreshSources(){
    const select=$('#sample-source'),selected=select.value;
    select.replaceChildren(...getTracks().map(track=>{const option=document.createElement('option');option.value=track.id;option.textContent=track.title;return option;}));
    if(getTracks().some(t=>t.id===selected))select.value=selected;
    if(!formInitialized&&getTracks().length){showAssignment();formInitialized=true;}
    $('#sample-load').disabled=getTracks().length===0;render();
  }
  function render(){
    assignments.forEach((a,i)=>{
      const slot=engine.sampler?.slots[i],playing=!!slot?.voice&&engine.ctx.currentTime>=slot.voice.when&&engine.ctx.currentTime<slot.voice.end;
      const signature=`${key(a)}|${busy[i]}|${playing}|${!!slot?.buffer}|${getTracks().length}`;
      if(signatures[i]===signature)return;signatures[i]=signature;
      pads[i].classList.toggle('loaded',!!a);pads[i].classList.toggle('playing',playing);pads[i].disabled=busy[i];
      pads[i].setAttribute('aria-label',a?`Play sample pad ${i+1}`:`Sample pad ${i+1}: empty`);pads[i].setAttribute('aria-pressed',String(playing));
      pads[i].querySelector('.sample-name').textContent=busy[i]?'Loading…':a?(getTracks().find(t=>t.id===a.trackId)?.title||'Source unavailable'):'Load a sample';
      pads[i].querySelector('.sample-meta').textContent=a?`${a.duration.toFixed(2)}s · ${slot?.buffer?'READY':'SAVED'}`:'ONE SHOT';
    });
    $('#sampler-volume-value').textContent=`${Math.round(Number($('#sampler-volume').value)*100)}%`;
  }
  async function ensureLoaded(i){
    const a=assignments[i];if(!a)throw new Error('Choose a source track and load a sample into this pad.');
    if(engine.sampler?.slots[i].buffer&&loadedKeys[i]===key(a))return true;
    if(busy[i])return false;
    const track=getTracks().find(t=>t.id===a.trackId);if(!track)throw new Error('The sample source is missing from this browser library.');
    const generation=generations[i];busy[i]=true;render();
    try{
      const buffer=await decodeTrack(track);if(generation!==generations[i]||assignments[i]!==a)return false;
      apply();const region=engine.sampler.assign(i,buffer,{start:a.start,duration:a.duration,name:track.title});a.start=region.start;a.duration=region.duration;loadedKeys[i]=key(a);save();return true;
    }finally{if(generation===generations[i])busy[i]=false;render();}
  }
  async function trigger(i){
    const before=epoch;if(!assignments[i]){$('#sample-target').value=String(i);notify('Choose a source track and click Load sample.');return;}
    if(await ensureLoaded(i)){if(before!==epoch)return;await engine.init();if(before!==epoch)return;apply();engine.sampler.trigger(i);render();if(engine.sampler.route==='headphones'&&engine.outputMode!=='split')notify('Sampler is routed to headphones. Enable split cable in Audio settings to hear it.');}
  }
  function stopAll(){epoch++;engine.sampler?.stopAll();render();}
  pads.forEach((pad,i)=>pad.onclick=safe(async event=>{
    if(event.shiftKey){generations[i]++;busy[i]=false;assignments[i]=null;loadedKeys[i]='';engine.sampler?.clear(i);save();render();return;}
    await trigger(i);
  }));
  $('#sample-load').onclick=safe(async()=>{
    const i=Number($('#sample-target').value),track=getTracks().find(t=>t.id===$('#sample-source').value);if(!track)throw new Error('Choose a track from your collection.');
    const start=Number($('#sample-start').value),duration=Number($('#sample-length').value);
    if(!Number.isFinite(start)||start<0||start>=track.duration||!Number.isFinite(duration)||duration<.05||duration>30)throw new Error('Choose a start inside the track and a length from 0.05 to 30 seconds.');
    if(busy[i])return;
    generations[i]++;assignments[i]={trackId:track.id,start,duration};loadedKeys[i]='';engine.sampler?.stop(i);render();
    if(await ensureLoaded(i))notify(`Sample loaded into pad ${i+1}. Click the pad to play.`);
  });
  $('#sample-target').onchange=showAssignment;
  $('#sampler-stop').onclick=stopAll;
  $('#sampler-volume').oninput=()=>{apply();save();render();};
  $('#sampler-route').onchange=()=>{apply();save();if($('#sampler-route').value==='headphones'&&engine.outputMode!=='split')notify('Headphone routing uses split output. Choose it in Audio settings.');};
  render();return {refreshSources,render,trigger,stopAll};
}
