import {cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Tests must pass before producing a new immutable build directory.
execFileSync(process.execPath,['--test',...((await readdir(path.join(root,'tests'))).filter(n=>n.endsWith('.test.mjs')).map(n=>path.join(root,'tests',n)))],{stdio:'inherit'});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const out=path.join(root,'dist',`vector-dj-0.1.0-${stamp}`);
await mkdir(out,{recursive:true});
for(const name of ['public','server.mjs','start.cmd','README.md','docs','package.json'])await cp(path.join(root,name),path.join(out,name),{recursive:true});
// Runtime has zero npm dependencies; only the development tests require xmldom.
await writeFile(path.join(out,'package.json'),JSON.stringify({name:'vector-dj-portable',version:'0.1.0',private:true,type:'module',scripts:{start:'node server.mjs'},engines:{node:'>=20'}},null,2));
const files=[];
async function inventory(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const p=path.join(folder,entry.name);if(entry.isDirectory())await inventory(p);else files.push({path:path.relative(out,p).replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(p)).digest('hex')});}}
await inventory(out);
await writeFile(path.join(out,'build-manifest.json'),JSON.stringify({builtAt:stamp,version:'0.1.0',runtime:'Node.js >=20 and a Web Audio capable browser',files},null,2));
await writeFile(path.join(root,'output','latest-build.json'),JSON.stringify({path:out,files:files.length},null,2));
console.log(`Portable build: ${out}`);
