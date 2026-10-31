import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { VisitorAuth, handleVisitorAuth } from '../server/src/expanse/visitor-auth.js';
import { signForTests, addressFromPrivateKey } from '../server/src/wallet.js';
const origin = 'https://preview.example';
async function fixture(t, limits = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visitor-release-'));
  const auth = new VisitorAuth({dataDir:dir, uri:'https://world.example/', allowedOrigins:[origin], ...limits});
  const server = http.createServer((req,res)=>handleVisitorAuth(req,res,auth));
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, token) => {
    const r=await fetch(base+'/api/auth/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  };
  const key=randomBytes(32).toString('hex'), address=addressFromPrivateKey(key);
  const login = async (signer=key) => {
    const c=(await call('nonce',{address,chainId:1})).body;
    return call('verify',{nonce:c.nonce,address,chainId:1,message:c.message,signature:signForTests(c.message,signer)});
  };
  const preflight = (headers={}) => fetch(base+'/api/auth/session',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,x-stratoks-origin',...headers}});
  return {auth,call,login,preflight};
}
test('verified same signer recovers after repeated reloads; only oldest own session revoked',async t=>{
  const a=await fixture(t,{maxSessionsPerAddress:3}); const tokens=[];
  for(let i=0;i<6;i++){const s=await a.login();assert.equal(s.status,200);tokens.push(s.body.token);assert.equal(a.auth.sessions.size,Math.min(i+1,3));}
  for(let i=0;i<tokens.length;i++)assert.equal((await a.call('session',undefined,tokens[i])).status,i<3?401:200);
});
test('failed signatures and failed profile writes never evict existing sessions',async t=>{
  const a=await fixture(t,{maxSessionsPerAddress:1});const s=await a.login();assert.equal(s.status,200);
  assert.equal((await a.login(randomBytes(32).toString('hex'))).status,401);
  const persist=a.auth.persist;a.auth.persist=()=>{throw Error('disk unavailable');};
  assert.equal((await a.login()).body.error,'profile_store_unavailable');a.auth.persist=persist;
  assert.equal((await a.call('session',undefined,s.body.token)).status,200);
  const replacement=await a.login();assert.equal(replacement.status,200);
  assert.equal((await a.call('session',undefined,s.body.token)).status,401);
});
test('allowlisted preflight survives exhausted auth quota and busy handlers; actual response retains cooldown',async t=>{
  const a=await fixture(t,{globalRequests:1});await a.call('config');
  const before=a.auth.global.count;
  assert.equal((await a.preflight()).status,204);assert.equal(a.auth.global.count,before);
  assert.equal((await a.call('session',undefined,'a'.repeat(64))).status,429);
  a.auth.activeRequests=a.auth.cfg.maxConcurrentRequests;
  assert.equal((await a.preflight()).status,204);
  assert.equal((await a.call('session',undefined,'a'.repeat(64))).status,503);
  assert.equal(a.auth.activeRequests,a.auth.cfg.maxConcurrentRequests);
});
test('preflight rejects untrusted origins, unsupported method and headers even under saturation',async t=>{
  const a=await fixture(t);a.auth.activeRequests=a.auth.cfg.maxConcurrentRequests;
  for(const headers of [{Origin:'https://evil.example'},{'Access-Control-Request-Method':'DELETE'},{'Access-Control-Request-Headers':'x-admin'}])assert.equal((await a.preflight(headers)).status,403);
});
