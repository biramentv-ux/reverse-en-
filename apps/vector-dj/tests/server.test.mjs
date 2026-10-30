import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createServer} from '../server.mjs';
test('Local server serves exact asset bytes, applies CSP, rejects private paths and limits methods',async t=>{
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const port=server.address().port;
  async function request(url,method='GET') {return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:url,method},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();
  });}
  const index=await request('/');assert.equal(index.status,200);assert.match(index.headers['content-security-policy'],/frame-ancestors 'none'/);assert.match(index.headers['content-type'],/text\/html/);assert.equal(index.headers['x-content-type-options'],'nosniff');assert.equal(index.headers['cache-control'],'no-store');
  assert.deepEqual(index.body,await readFile(new URL('../public/index.html',import.meta.url)));
  for(const [url,mime] of [['/app.js','text/javascript'],['/style.css','text/css'],['/vendor/soundtouch-2.1.1/LICENSE','application/octet-stream']]){const r=await request(url);assert.equal(r.status,200);assert.ok(r.headers['content-type'].startsWith(mime));}
  assert.equal((await request('/app.js','HEAD')).body.length,0);
  for(const url of ['/server.mjs','/package.json','/missing','/vendor/','/%ZZ'])assert.equal((await request(url)).status,404,url);
  for(const url of ['/%2e%2e%5cserver.mjs','/.private','/vendor/.secret'])assert.equal((await request(url)).status,403,url);
  for(const method of ['POST','PUT','DELETE','OPTIONS']){const r=await request('/',method);assert.equal(r.status,405);assert.equal(r.headers.allow,'GET, HEAD');}
});
