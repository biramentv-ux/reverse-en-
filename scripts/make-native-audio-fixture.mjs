import {synthesize} from '../public/dsp.js';import {mkdir,writeFile} from 'node:fs/promises';
const sr=48000,samples=synthesize(sr,120,4),data=Buffer.alloc(samples.length*4),header=Buffer.alloc(44);
for(let i=0;i<samples.length;i++){const n=Math.round(Math.max(-1,Math.min(1,samples[i]))*32767);data.writeInt16LE(n,i*4);data.writeInt16LE(n,i*4+2);}
header.write('RIFF');header.writeUInt32LE(data.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(sr,24);header.writeUInt32LE(sr*4,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);
await mkdir(new URL('../output/native-fixtures/',import.meta.url),{recursive:true});await writeFile(new URL('../output/native-fixtures/ORBIT Original - Native session.wav',import.meta.url),Buffer.concat([header,data]));
await writeFile(new URL('../output/native-fixtures/invalid-audio.wav',import.meta.url),'ORBIT QA invalid audio fixture');
