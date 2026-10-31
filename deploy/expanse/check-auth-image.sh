#!/bin/sh
# Isolated image startup/ARM/module/auth proof. Never mount the live data volume.
set -eu
image=stratoks-expanse-auth-check
platform=${1:-linux/arm64}
if docker buildx version >/dev/null 2>&1; then
  docker buildx build --platform "$platform" --load -f deploy/expanse/Dockerfile -t "$image" .
else
  native=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
  [ "$native" = "$platform" ] || { echo "Need buildx/emulation for $platform on $native" >&2; exit 1; }
  docker build -f deploy/expanse/Dockerfile -t "$image" .
fi
container=$(docker run -d --platform "$platform" --read-only --tmpfs /data:uid=1000,gid=1000,mode=0700 --tmpfs /tmp \
  -e AUTH_URI=http://localhost:8790/ -e AUTH_LOCAL_DEMO=true -e INITIAL_SEED_COUNT=3 -e TICK_MS=1000 "$image")
trap 'docker rm -f "$container" >/dev/null' EXIT INT TERM
# This script runs inside the built image, as the unprivileged image user.
docker exec -i "$container" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { signForTests, addressFromPrivateKey } from './server/src/wallet.js';
await import('./shared/relief.js');
await import('./shared/visitor-challenge.js');
await import('./server/src/expanse/visitor-auth.js');
let ready = false;
for (let n = 0; n < 20; n++) {
  try { ready = (await fetch('http://localhost:8788/healthz')).ok; } catch {}
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
assert.ok(ready, 'image must start');
const origin = 'http://localhost:8790';
async function call(route, body, token) {
  const r = await fetch('http://localhost:8788/api/auth/' + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const key = randomBytes(32).toString('hex'), address = addressFromPrivateKey(key);
assert.equal((await call('config')).body.enabled, true);
const c = (await call('nonce', { address, chainId: 1 })).body;
const s = await call('verify', { nonce: c.nonce, address, chainId: 1, message: c.message, signature: signForTests(c.message, key) });
assert.equal(s.status, 200); assert.equal(s.body.role, 'visitor');
assert.equal((await call('session', undefined, s.body.token)).status, 200);
assert.equal((await call('logout', {}, s.body.token)).status, 200);
assert.equal((await call('session', undefined, s.body.token)).status, 401);
assert.equal((await fetch('http://localhost:8788/api/expanse/frame')).status, 200);
console.log(JSON.stringify({ ok: true, architecture: process.arch, modules: true, anonymousViewing: true, signatureVerification: true, logoutRevocation: true }));
JS
