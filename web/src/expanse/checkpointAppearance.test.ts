import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Expanse } from '../../../server/src/expanse/engine.js';
import { frame } from '../../../server/src/expanse/view.js';
import { residentPose, residentSprite } from './appearance';
import type { WorldFrame } from './types';

test('acf64fa: Vizigu after four ordinary checkpoint ticks gathers wood with bare hands',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('../../public/demo/agency-checkpoint.json.gz',import.meta.url))).toString());
 const e=Expanse.fromState(saved);for(let i=0;i<4;i++)e.step();
 const f=frame(e,{x:-23,y:-23,w:94,h:94}) as WorldFrame,r=f.residents.find(r=>r.id===100)!;
 assert.equal(e.tick,12604);assert.equal(r.name,'Vizigu');
 assert.deepEqual([r.x,r.y,r.state,r.phase,r.progress,r.item],[58,61,'gather','gather',.17,'wood']);
 assert.deepEqual(r.tools,[]);assert.deepEqual(r.carrying,{});
 assert.equal(residentPose(r,f,false),'work');
 for(const direction of ['se','sw','ne','nw'])for(let phase=0;phase<6;phase++)assert.ok(residentSprite(r,f,false,direction,phase).startsWith('idle.'));
 assert.ok(f.view.nodes.some(n=>n[1]==='tree'&&n[2]===57&&n[3]===60&&n[4]>0));
});
