const http=require('node:http'),path=require('node:path');
const {readFile}=require('node:fs/promises');
const TYPES={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json'};
const CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
function createLocalServer(root){
  root=path.resolve(root);
  return http.createServer(async(req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end('Method not allowed');return;}
    const port=res.socket.localPort;
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403).end('Forbidden host');return;}
    try{
      if(!req.url.startsWith('/')){res.writeHead(400).end('Bad request');return;}
      const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),target=path.resolve(root,relative);
      if(!target.startsWith(root+path.sep)||relative.split(/[\\/]/).some(p=>p.startsWith('.'))){res.writeHead(403).end('Forbidden');return;}
      const body=await readFile(target);res.writeHead(200,{'Content-Type':(TYPES[path.extname(target)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':CSP,'Permissions-Policy':'camera=(), microphone=(), geolocation=()'});res.end(req.method==='HEAD'?undefined:body);
    }catch(error){res.writeHead(error instanceof URIError?400:404).end(error instanceof URIError?'Bad request':'Not found');}
  });
}
module.exports={createLocalServer,CSP};
