import {DECK_IDS} from './mixer-routing.js';
export function midiTargets(document){
  const targets=[];
  function button(id,label,selector,group){const element=()=>document.querySelector(selector);targets.push({id,label,group,kind:'button',exists:()=>!!element(),available:()=>!!element()&&!element().disabled,run:()=>element()?.click()});}
  function range(id,label,selector,group){const element=()=>document.querySelector(selector);targets.push({id,label,group,kind:'continuous',exists:()=>!!element(),available:()=>!!element()&&!element().disabled,get:()=>{const e=element();return (Number(e.value)-Number(e.min))/(Number(e.max)-Number(e.min));},set:value=>{const e=element();if(!e)return;e.value=String(Number(e.min)+value*(Number(e.max)-Number(e.min)));e.dispatchEvent(new document.defaultView.Event('input',{bubbles:true}));}});}
  range('mix.crossfade','Crossfader','#crossfade','Mixer');range('mix.master','Master volume','#master','Mixer');
  range('sampler.volume','Sampler level','#sampler-volume','Sampler');button('sampler.stop','Stop samples','#sampler-stop','Sampler');
  for(let i=1;i<=4;i++)button(`sampler.pad${i}`,`Sampler pad ${i}`,`.sample-pad:nth-child(${i})`,'Sampler');
  for(const id of DECK_IDS){
    const letter=id.toUpperCase(),root=`#deck-${id}`,group=`Deck ${letter}`;
    for(const [name,label,selector] of [['play','Play / pause','.play'],['cue','Return to start','.cue-button'],['sync','Beat sync','.sync'],['pfl','Headphone preview','.pfl'],['key','Key lock','.key-lock'],['loopOff','Loop off','.loop-off'],['fxReset','Reset FX','.fx-clear']])button(`deck.${id}.${name}`,`${letter} · ${label}`,`${root} ${selector}`,group);
    for(const beats of [1,2,4,8,16])button(`deck.${id}.loop${beats}`,`${letter} · Loop ${beats} beats`,`${root} [data-beats="${beats}"]`,group);
    for(let n=1;n<=8;n++)button(`deck.${id}.cue${n}`,`${letter} · Hot cue ${n}`,`${root} [data-cue="${n-1}"]`,group);
    for(const [name,label,selector] of [['volume','Volume',`#volume-${id}`],['tempo','Tempo',`${root} .tempo`],['high','High EQ',`#high-${id}`],['mid','Mid EQ',`#mid-${id}`],['low','Low EQ',`#low-${id}`],['filter','Filter',`#filter-${id}`],['echo','Echo amount',`${root} .fx-echo`],['room','Room amount',`${root} .fx-room`]])range(`deck.${id}.${name}`,`${letter} · ${label}`,selector,group);
  }
  return targets;
}

