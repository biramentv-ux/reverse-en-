import {open, lstat, readdir, mkdir, writeFile, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

async function inventory(root) {
  const entries = [];
  async function walk(relative) {
    const absolute = path.join(root, relative), stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links require an explicit comparison policy: ${absolute}`);
    if (stat.isDirectory()) {
      entries.push({path: relative.replaceAll('\\', '/'), type: 'directory'});
      for (const name of (await readdir(absolute)).sort()) await walk(path.join(relative, name));
    } else if (stat.isFile()) {
      const handle = await open(absolute, 'r'), hash = createHash('sha256');
      try { for await (const chunk of handle.createReadStream({autoClose:false})) hash.update(chunk); }
      finally { await handle.close(); }
      entries.push({path: relative.replaceAll('\\', '/'), type:'file', size:stat.size, sha256:hash.digest('hex')});
    } else throw new Error(`Unsupported artifact type: ${absolute}`);
  }
  await walk('');
  return entries;
}

async function firstDifference(left, right) {
  const a = await open(left, 'r'), b = await open(right, 'r');
  const ba = Buffer.alloc(65536), bb = Buffer.alloc(65536);
  let offset = 0;
  try {
    for (;;) {
      const [ra, rb] = await Promise.all([a.read(ba,0,ba.length,offset), b.read(bb,0,bb.length,offset)]);
      const length = Math.min(ra.bytesRead,rb.bytesRead);
      for (let i=0; i<length; i++) if (ba[i] !== bb[i]) return offset+i;
      if (ra.bytesRead !== rb.bytesRead) return offset+length;
      if (!length) return null;
      offset += length;
    }
  } finally { await a.close(); await b.close(); }
}

// No whitespace, number, audio or XML normalization: this is literal byte equality.
export async function compareArtifacts(referencePath, candidatePath) {
  const reference = await realpath(referencePath), candidate = await realpath(candidatePath);
  if (reference === candidate) throw new Error('Reference and candidate must be independently located artifacts.');
  const before = await Promise.all([inventory(reference),inventory(candidate)]);
  const left = new Map(before[0].map(e=>[e.path,e])), right = new Map(before[1].map(e=>[e.path,e]));
  const comparisons = [];
  for (const name of [...new Set([...left.keys(),...right.keys()])].sort()) {
    const a=left.get(name),b=right.get(name);
    if (!a || !b) { comparisons.push({path:name,status:!a?'extra-candidate':'missing-candidate'}); continue; }
    if (a.type !== b.type) { comparisons.push({path:name,status:'type-mismatch'}); continue; }
    if (a.type === 'directory') { comparisons.push({path:name,status:'equal-directory'}); continue; }
    const offset=await firstDifference(path.join(reference,name),path.join(candidate,name));
    comparisons.push({path:name,status:offset===null?'equal-bytes':'different-bytes',firstDifference:offset,referenceBytes:a.size,candidateBytes:b.size});
  }
  // Re-read live files after comparison; changing source cannot certify a stable match.
  const after = await Promise.all([inventory(reference),inventory(candidate)]);
  const stable = JSON.stringify(before) === JSON.stringify(after);
  const equal = comparisons.every(c=>c.status==='equal-bytes'||c.status==='equal-directory');
  const evidence = createHash('sha256').update(JSON.stringify({reference,candidate,before,after,comparisons})).digest('hex');
  return {schemaVersion:1,evidenceId:`bytes-${evidence}`,testedAt:new Date().toISOString(),reference,candidate,
    status:!stable?'SOURCE_CHANGED':equal?'MATCH':'DIFFERENT',stable,referenceInventory:before[0],candidateInventory:before[1],comparisons,
    scope:'Only the supplied artifacts. This does not prove untested behavior or whole-application equivalence.'};
}

export async function runComparison(argv) {
  const args = new Map();
  for(let i=0;i<argv.length;i+=2) {
    if(!['--reference','--candidate','--report'].includes(argv[i])||!argv[i+1]||args.has(argv[i]))throw new Error('Use --reference PATH --candidate PATH --report PATH.');
    args.set(argv[i],argv[i+1]);
  }
  if(!args.get('--reference')||!args.get('--candidate')||!args.get('--report'))throw new Error('A reference, candidate and external report path are required.');
  const report=path.resolve(args.get('--report'));
  for(const key of ['--reference','--candidate']) {
    const artifact=await realpath(args.get(key)),relative=path.relative(artifact,report);
    if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('Write the report outside both compared artifacts.');
  }
  const result=await compareArtifacts(args.get('--reference'),args.get('--candidate'));
  await mkdir(path.dirname(report),{recursive:true});
  await writeFile(report,JSON.stringify(result,null,2)+'\n');
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const result=await runComparison(process.argv.slice(2));console.log(`${result.status}: ${result.comparisons.length} entries; ${result.evidenceId}`);process.exitCode=result.status==='MATCH'?0:1; }
  catch(error){console.error(`UNVERIFIED: ${error.message}`);process.exitCode=2;}
}
