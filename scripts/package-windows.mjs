import {packager} from '@electron/packager';
import {mkdtemp,mkdir,cp,readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const output=path.join(root,'output','desktop-builds',pkg.version);
try{await access(output);throw new Error('This build folder already exists. Keep the prior build and use a new version.');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(output,{recursive:true});const staging=await mkdtemp(path.join(os.tmpdir(),'orbit-desktop-'));
await mkdir(path.join(staging,'desktop'));
for(const name of ['main.cjs','static-server.cjs'])await cp(path.join(root,'desktop',name),path.join(staging,'desktop',name));
await cp(path.join(root,'public'),path.join(staging,'public'),{recursive:true,filter:source=>!/(?:^|[\\/])(?:qa\.(?:html|js|css)|.*-qa\.(?:html|js)|keylock-probe\.(?:html|js))$/.test(source)});
await writeFile(path.join(staging,'package.json'),JSON.stringify({name:'orbit-dj-studio',productName:'ORBIT DJ Studio',version:pkg.version,main:'desktop/main.cjs',private:true},null,2));
const electronVersion=pkg.devDependencies.electron;
const builds=await packager({dir:staging,out:output,name:'ORBIT DJ Studio',platform:'win32',arch:'x64',electronVersion,asar:true,overwrite:false,prune:false,appVersion:pkg.version,appCopyright:'ORBIT DJ Studio',win32metadata:{CompanyName:'ORBIT DJ Studio',FileDescription:'ORBIT DJ Studio',ProductName:'ORBIT DJ Studio',OriginalFilename:'ORBIT DJ Studio.exe',InternalName:'orbit-dj-studio'}});
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const build=builds[0],exe=path.join(build,'ORBIT DJ Studio.exe'),asar=path.join(build,'resources','app.asar');
await writeFile(path.join(output,'build-manifest.json'),JSON.stringify({version:pkg.version,electronVersion,platform:'win32-x64',executable:exe,sha256:{executable:await hash(exe),appAsar:await hash(asar)},signed:false,sourceRoot:root,staging},null,2));
console.log(`Portable Windows build: ${exe}`);
