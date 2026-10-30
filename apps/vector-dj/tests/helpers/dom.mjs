import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
export async function domFixture(t, html) {
  const dom=new JSDOM(html ?? await readFile(new URL('../../public/index.html',import.meta.url),'utf8'),{url:'http://127.0.0.1:4318',pretendToBeVisual:true});
  const previous=new Map();
  const values={window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,DOMParser:dom.window.DOMParser,indexedDB:new IDBFactory(),navigator:dom.window.navigator,requestAnimationFrame:()=>1,devicePixelRatio:1};
  for(const [name,value] of Object.entries(values)){previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});}
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new dom.window.Event('close'));};
  t.after(()=>{dom.window.close();for(const [name,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
  return {dom,document:dom.window.document,$:s=>dom.window.document.querySelector(s)};
}
export const tick=()=>new Promise(resolve=>setImmediate(resolve));
export const xml='<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1"><TRACK TrackID="1" Name="Тест &amp; сет" Artist="A" Location="file://localhost/C:/Music/test.wav" TotalTime="10" AverageBpm="120"><TEMPO Inizio="0.5" Bpm="120" Metro="4/4" Battito="1"/><POSITION_MARK Type="0" Num="0" Start="1"/></TRACK></COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Type="1" Name="Set" KeyType="0"><TRACK Key="1"/></NODE></NODE></PLAYLISTS></DJ_PLAYLISTS>';
export function setFiles(input,files){Object.defineProperty(input,'files',{value:files,configurable:true});}
