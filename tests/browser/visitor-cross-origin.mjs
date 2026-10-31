// Real browser CORS regressions. Disposable signer, no request interception or wallet transactions.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {VisitorAuth,handleVisitorAuth} from '../../server/src/expanse/visitor-auth.js';
import {signForTests,addressFromPrivateKey} from '../../server/src/wallet.js';
const {chromium}=await import(process.argv[2]);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cors-regression-'));
const frontend=http.createServer((q,r)=>{
 if(q.url==='/visitor-auth-client.js'||q.url==='/visitor-challenge.js') {r.setHeader('Content-Type','text/javascript');r.end(fs.readFileSync(new URL('../../shared'+q.url,import.meta.url)));}
 else {r.setHeader('Content-Type','text/html');r.end('<!doctype html><title>Isolated CORS regression</title>');}
});
frontend.listen(0,'127.0.0.1');await once(frontend,'listening');
const origin=`http://127.0.0.1:${frontend.address().port}`;
let auth;
const seen=[];
const backend=http.createServer((q,r)=>{r.on('finish',()=>seen.push({method:q.method,path:q.url,status:r.statusCode}));handleVisitorAuth(q,r,auth);});
backend.listen(0,'127.0.0.1');await once(backend,'listening');
const api=`http://127.0.0.1:${backend.address().port}`;
auth=new VisitorAuth({dataDir:dir,uri:api+'/',allowedOrigins:[origin],localDemo:true});
let browser;
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const key=randomBytes(32).toString('hex'),address=addressFromPrivateKey(key);
 await page.exposeFunction('signDisposable',hex=>signForTests(Buffer.from(hex.slice(2),'hex').toString('utf8'),key));
 await page.goto(origin);
 await page.evaluate(async({api,origin,address})=>{
  const {VisitorAuthClient}=await import('/visitor-auth-client.js');
  window.client=new VisitorAuthClient({baseUrl:api,uri:api+'/',origin});
  await client.connect({request:async({method,params})=>{
   if(['eth_accounts','eth_requestAccounts'].includes(method))return [address];
   if(method==='eth_chainId')return '0x1';
   if(method==='personal_sign')return window.signDisposable(params[0]);
   throw Error('Blocked RPC: '+method);
  }});
  await client.signIn();if(client.state!=='verified')throw Error(client.error);
 },{api,origin,address});
 auth.global.count=auth.cfg.globalRequests;
 await page.evaluate(()=>client.refreshSession());
 const state=await page.evaluate(()=>({state:client.state,retained:!!client.session,wait:client.retryAfterUntil-Date.now(),revocations:client.revocations.size}));
 assert.equal(state.state,'unavailable');assert.equal(state.retained,true);assert.ok(state.wait>58000);assert.equal(state.revocations,0);
 assert.ok(seen.some(x=>x.method==='OPTIONS'&&x.path==='/api/auth/session'&&x.status===204));
 assert.ok(seen.some(x=>x.method==='GET'&&x.path==='/api/auth/session'&&x.status===429));
 auth.global.count=0;auth.activeRequests=auth.cfg.maxConcurrentRequests;
 const busy=await page.evaluate(async(api)=>{const r=await fetch(api+'/api/auth/session',{headers:{'X-Stratoks-Origin':location.origin,Authorization:'Bearer '+client.session.token},cache:'no-store'});return {status:r.status,retry:r.headers.get('Retry-After')};},api);
 assert.deepEqual(busy,{status:503,retry:'1'});
 auth.activeRequests=0;
 await page.evaluate(async()=>{client.clearRetry();await client.refreshSession();if(client.state!=='verified')throw Error(client.error);await client.logout();});
 assert.equal(auth.sessions.size,0);
 console.log(JSON.stringify({realChromium:true,crossOrigin:true,verified:true,rateLimit:state,busy,recoveryAndLogout:true,traffic:seen}));
}finally{await browser?.close();frontend.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise(r=>frontend.close(r)),new Promise(r=>backend.close(r))]);fs.rmSync(dir,{recursive:true,force:true});}
