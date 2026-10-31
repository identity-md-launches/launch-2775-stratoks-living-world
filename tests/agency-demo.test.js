import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {Expanse,expectedHoldings} from '../server/src/expanse/engine.js';
import {migrateExpanse,identityDigest} from '../server/src/expanse/persist.js';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const atRoot = (...parts) => path.join(root, ...parts);
const original=fs.readFileSync(atRoot('web/public/demo/checkpoint.json.gz'));
const manifest=JSON.parse(fs.readFileSync(atRoot('web/public/demo/agency-manifest.json')));
// The manifest sha256 pins the BYTES the base engine (d0ee752) produced after 600 ticks. The resource/chain engine
// change (server/docs/CHAINS.md) intentionally changes behaviour, so the shipped web demo checkpoint (owned by the
// web integration step) is no longer reproduced byte-for-byte; it must be regenerated there. What stays asserted:
// the original backup bytes, identity-preserving migration, determinism of the 600-tick replay and the item ledger.
test('exact original backup migrates with unchanged identity and replays 600 ordinary ticks deterministically',()=>{
 assert.equal(hash(original),'cf2dcd95a83ffa1cc50975b40f9c6cb5829637ae0b3b9ff3f07846be12a5d716');
 const old=JSON.parse(zlib.gunzipSync(original)), migrated=migrateExpanse(structuredClone(old)).state;
 assert.equal(identityDigest(old),identityDigest(migrated));
 assert.equal(old.schema,4);assert.equal(migrated.schema,5);
 const e=Expanse.fromState(structuredClone(migrated));e.run(600);
 const e2=Expanse.fromState(structuredClone(migrated));e2.run(600);
 assert.equal(JSON.stringify(e.toState()),JSON.stringify(e2.toState()),'replay is deterministic');
 const h=e.holdings(),x=expectedHoldings(e.totals);for(const k of new Set([...Object.keys(h),...Object.keys(x)]))assert.equal(h[k]??0,x[k]??0,k);
 assert.equal(hash(fs.readFileSync(atRoot('web/public/demo/agency-checkpoint.json.gz'))),manifest.sha256);
 assert.equal(hash(fs.readFileSync(atRoot('dist/demo/checkpoint.json.gz'))),hash(original));
 assert.equal(hash(fs.readFileSync(atRoot('dist/demo/agency-checkpoint.json.gz'))),manifest.sha256);
 assert.equal(e.id,old.id);assert.equal(e.tick,old.tick+600);
});
test('updated demo exact restart retains goals, trust, brains, families and terrain',()=>{
 const saved=JSON.parse(zlib.gunzipSync(fs.readFileSync(atRoot('web/public/demo/agency-checkpoint.json.gz'))));
 const a=Expanse.fromState(saved);a.run(40);
 const b=Expanse.fromState(a.toState());a.run(40);b.run(40);
 assert.deepEqual(a.toState(),b.toState());
});
