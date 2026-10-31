import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceCell, resourceGroups, stockMembers } from './resources';
import { frame } from '../../../server/src/expanse/view.js';
import { Expanse } from '../../../server/src/expanse/engine.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { projectSurface } from './surface';
import type {WorldFrame} from './types';
const checkpoint=JSON.parse(gunzipSync(readFileSync(new URL('../../public/demo/agency-checkpoint.json.gz',import.meta.url))).toString());
const world=Expanse.fromState(checkpoint);
const f=frame(world,{x:-23,y:-23,w:94,h:94}) as WorldFrame;
const sums=(rows:{items:Record<string,number>}[])=>{const out:Record<string,number>={};for(const r of rows)for(const [k,n] of Object.entries(r.items))if(n>0)out[k]=(out[k]??0)+n;return out;};
test('all zoom levels preserve each stock once, exact quantities and real member anchors',()=>{
 const before=JSON.stringify(f),members=stockMembers(f);
 for(const w of [390,1440])for(const span of [9,9.5,22,41.725]){
  const groups=resourceGroups(f,{x:24,y:24,span},{w,h:764});
  assert.deepEqual(sums(groups),sums(members));
  assert.deepEqual(groups.flatMap(g=>g.members.map(m=>m.key)).sort(),members.map(m=>m.key).sort());
  for(const g of groups){assert.deepEqual(sums(g.members),g.items);assert.ok(g.members.some(m=>m.x===g.x&&m.y===g.y));assert.equal(new Set(g.members.map(m=>m.kind)).size,1);}
 }
 assert.equal(JSON.stringify(f),before,'presentation cannot mutate the received world');
});
test('checkpoint overview bounds visible wood markers on desktop and mobile',()=>{
 for(const [w,h,span] of [[1440,764,22],[1440,764,41.725],[390,706,9.5],[390,706,18.288]]){
  const c={x:24,y:24,span},size={w,h};
  const visible=(p:{x:number;y:number})=>{const q=projectSurface({x:p.x+.85,y:p.y+1},f,c,size);return q.x>0&&q.y>0&&q.x<w&&q.y<h;};
  const raw=stockMembers(f).filter(p=>p.items.wood>0&&visible(p));
  const grouped=resourceGroups(f,c,size).filter(g=>g.items.wood>0&&visible(g));
  assert.ok(grouped.length<raw.length*.55,`${w}/${span}: ${raw.length} wood stocks become ${grouped.length} markers`);
 }
 assert.equal(resourceCell({x:0,y:0,span:9},{w:1440,h:900}),1,'close desktop zoom reveals individual piles');
});
test('legacy frames without clusters have identical grouping; no quantities depend on summaries',()=>{
 const c={x:24,y:24,span:22},size={w:1440,h:764};
 assert.deepEqual(resourceGroups(f,c,size),resourceGroups({...f,view:{...f.view,pileClusters:undefined}},c,size));
});
