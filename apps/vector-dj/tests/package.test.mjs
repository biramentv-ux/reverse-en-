import test from 'node:test';
import {readFile,readdir,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('Browser source parses and every local module import and stylesheet exists',async()=>{
  const publicRoot=path.join(root,'public');
  for(const name of await readdir(publicRoot)){
    if(!/\.(js|html)$/.test(name))continue;
    const source=await readFile(path.join(publicRoot,name),'utf8');
    if(name.endsWith('.js'))execFileSync(process.execPath,['--check',path.join(publicRoot,name)]);
    const refs=[...source.matchAll(/(?:from\s*['"]|(?:src|href)=["'])([^"']+)["']/g)].map(m=>m[1]).filter(r=>/\.(js|css)$/.test(r));
    for(const ref of refs)await access(path.resolve(publicRoot,ref.replace(/^\//,'')));
  }
});
