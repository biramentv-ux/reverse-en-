import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {compareArtifacts,runComparison} from '../scripts/compare-artifacts.mjs';
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'vector-byte-test-'));await mkdir(path.join(root,'reference'));await mkdir(path.join(root,'candidate'));return {root,a:path.join(root,'reference'),b:path.join(root,'candidate')};}
test('Exact equality compares bytes across multiple chunks, including nulls and non-UTF8',async()=>{
  const {root,a,b}=await fixture(),data=Buffer.alloc(180000,255);data[64000]=0;
  await writeFile(path.join(a,'audio.bin'),data);await writeFile(path.join(b,'audio.bin'),data);
  const r=await runComparison(['--reference',a,'--candidate',b,'--report',path.join(root,'evidence.json')]);
  assert.equal(r.status,'MATCH');assert.equal(r.stable,true);assert.equal(r.comparisons.find(c=>c.path==='audio.bin').firstDifference,null);
  assert.equal(JSON.parse(await readFile(path.join(root,'evidence.json'),'utf8')).evidenceId,r.evidenceId);
});
test('A single differing byte reports the exact offset and fails comparison',async()=>{
  const {a,b}=await fixture(),left=Buffer.alloc(150000),right=Buffer.from(left);right[131072]=1;
  await writeFile(path.join(a,'out'),left);await writeFile(path.join(b,'out'),right);
  const r=await compareArtifacts(a,b);assert.equal(r.status,'DIFFERENT');assert.equal(r.comparisons.find(c=>c.path==='out').firstDifference,131072);
});
test('Length, missing files, extra files, empty directories and file/directory changes are distinct',async()=>{
  const {a,b}=await fixture();
  await writeFile(path.join(a,'long'),Buffer.from([1,2,3]));await writeFile(path.join(b,'long'),Buffer.from([1,2]));
  await writeFile(path.join(a,'missing'),'x');await writeFile(path.join(b,'extra'),'x');
  await mkdir(path.join(a,'kind'));await writeFile(path.join(b,'kind'),'x');
  await mkdir(path.join(a,'empty'));await mkdir(path.join(b,'empty'));
  const r=await compareArtifacts(a,b),entries=new Map(r.comparisons.map(e=>[e.path,e]));
  assert.equal(r.status,'DIFFERENT');assert.equal(entries.get('long').firstDifference,2);assert.equal(entries.get('missing').status,'missing-candidate');assert.equal(entries.get('extra').status,'extra-candidate');assert.equal(entries.get('kind').status,'type-mismatch');assert.equal(entries.get('empty').status,'equal-directory');
});
test('Direct file comparison supports empty files and detects leading differences',async()=>{
  const {root}=await fixture(),a=path.join(root,'a'),b=path.join(root,'b');await writeFile(a,'');await writeFile(b,'');
  assert.equal((await compareArtifacts(a,b)).status,'MATCH');await writeFile(b,'x');assert.equal((await compareArtifacts(a,b)).comparisons[0].firstDifference,0);
});
test('Self comparison, absent targets, malformed CLI and reports inside artifacts cannot certify a match',async()=>{
  const {root,a,b}=await fixture();await assert.rejects(compareArtifacts(a,a),/independently/);await assert.rejects(compareArtifacts(a,path.join(root,'absent')));
  for(const args of [[],['--bad','x'],['--reference',a,'--reference',a],['--reference',a,'--candidate',b,'--report',path.join(a,'report.json')]])await assert.rejects(runComparison(args));
});
test('Symlinked source entries are rejected rather than silently skipping data',async t=>{
  const {root,a,b}=await fixture();await writeFile(path.join(root,'target'),'x');
  try{await symlink(path.join(root,'target'),path.join(a,'link'));}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('Host does not permit symlink creation');return;}throw e;}
  await assert.rejects(compareArtifacts(a,b),/Symbolic links/);
});
