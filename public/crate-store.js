const NAME_LIMIT=60,CRATE_LIMIT=100,TRACK_LIMIT=5000;
export const CRATE_KEY='orbit-crates-v1';
// Keep thrown persistence errors inside an async callback for consistent lock release.
export async function withCrateLock(change,locks=globalThis.navigator?.locks){return locks?.request?locks.request(CRATE_KEY,async()=>change()):change();}
const cleanText=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new Error(`Invalid ${label}.`);return value.trim();};
export function crateName(value){return cleanText(value,NAME_LIMIT,'crate name (1–60 characters)');}
export function validateCatalog(value){
  if(value?.format!=='orbit-crates'||value.version!==1||!Array.isArray(value.crates)||value.crates.length>CRATE_LIMIT)throw new Error('Use an ORBIT crates backup with at most 100 crates.');
  const ids=new Set(),names=new Set();
  const crates=value.crates.map(crate=>{
    const id=cleanText(crate?.id,160,'crate ID'),name=crateName(crate?.name),key=name.toLowerCase();
    if(ids.has(id)||names.has(key))throw new Error('Crate IDs and names must be unique.');ids.add(id);names.add(key);
    if(!Array.isArray(crate.trackIds)||crate.trackIds.length>TRACK_LIMIT)throw new Error('A crate can contain at most 5000 tracks.');
    const trackIds=crate.trackIds.map(id=>cleanText(id,1024,'track ID'));if(new Set(trackIds).size!==trackIds.length)throw new Error('A crate contains duplicate tracks.');
    return {id,name,trackIds};
  });
  const catalog={format:'orbit-crates',version:1,revision:Number.isSafeInteger(value.revision)&&value.revision>=0?value.revision:0,crates};
  if(JSON.stringify(catalog,null,2).length>2000000)throw new Error('Crates backup is too large.');
  return catalog;
}
const empty=()=>({format:'orbit-crates',version:1,revision:0,crates:[]});
export class CrateStore{
  constructor(storage=null,{makeId=()=>`crate-${crypto.randomUUID()}`}={}){this.storage=storage;this.makeId=makeId;this.data=empty();this.refresh();}
  refresh(){const raw=this.storage?.getItem(CRATE_KEY);if(raw!==null&&raw!==undefined){if(raw.length>2000000)throw new Error('Crates backup is too large.');this.data=validateCatalog(JSON.parse(raw));}else this.data=empty();return this.snapshot();}
  snapshot(){return structuredClone(this.data);}
  commit(change){
    if(this.storage)this.refresh();const next=this.snapshot();change(next.crates);next.revision=this.data.revision+1;const valid=validateCatalog(next);
    if(this.storage)this.storage.setItem(CRATE_KEY,JSON.stringify(valid));this.data=valid;return this.snapshot();
  }
  create(name){const id=this.makeId();this.commit(crates=>crates.push({id,name:crateName(name),trackIds:[]}));return id;}
  find(crates,id){const crate=crates.find(c=>c.id===id);if(!crate)throw new Error('This crate no longer exists.');return crate;}
  rename(id,name){return this.commit(crates=>{this.find(crates,id).name=crateName(name);});}
  remove(id){return this.commit(crates=>{const crate=this.find(crates,id);crates.splice(crates.indexOf(crate),1);});}
  addTracks(id,trackIds){return this.commit(crates=>{const crate=this.find(crates,id);crate.trackIds=[...new Set([...crate.trackIds,...trackIds])];});}
  removeTracks(id,trackIds){const removed=new Set(trackIds);return this.commit(crates=>{const crate=this.find(crates,id);crate.trackIds=crate.trackIds.filter(id=>!removed.has(id));});}
  move(id,trackId,direction){
    if(![-1,1].includes(direction))throw new Error('Choose move up or down.');
    return this.commit(crates=>{const crate=this.find(crates,id),from=crate.trackIds.indexOf(trackId),to=from+direction;if(from<0)throw new Error('This track is not in the crate.');if(to>=0&&to<crate.trackIds.length)[crate.trackIds[from],crate.trackIds[to]]=[crate.trackIds[to],crate.trackIds[from]];});
  }
  exportText(){return JSON.stringify(this.snapshot(),null,2);}
  importText(text){
    if(typeof text!=='string'||text.length>2000000)throw new Error('Crates backup is too large.');let parsed;try{parsed=JSON.parse(text);}catch{throw new Error('Paste valid crates JSON.');}const imported=validateCatalog(parsed);
    return this.commit(crates=>{for(const crate of imported.crates){const at=crates.findIndex(c=>c.id===crate.id);if(at<0)crates.push(crate);else crates[at]=crate;}});
  }
}
export function crateTracks(crate,tracks){const byId=new Map(tracks.map(t=>[t.id,t]));return crate.trackIds.map(id=>byId.get(id)).filter(Boolean);}
