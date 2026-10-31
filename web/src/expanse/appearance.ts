import { cap } from '../../../server/src/expanse/capabilities.js';
import type { Resident, WorldFrame } from './types';
export function constructionStage(site: NonNullable<WorldFrame['view']['sites']>[number]) {
  if (!Object.values(site.materials).some(n=>n>0)) return 'marker';
  return site.stage>=1 ? 'frame' : 'foundation';
}
export type Pose = 'idle' | 'walk' | 'rest' | 'sleep' | 'gather' | 'chop' | 'pickup' | 'work' | 'carry' | 'hold' | 'build' | 'fish' | 'plant' | 'tend' | 'harvest' | 'cook';
const WOOD_NODES = new Set(['tree', 'deadfall', 'driftwood', 'scrub']);
export function carried(r: Resident, f: WorldFrame) {
  return r.carrying ?? (f.inspector?.id === r.id ? f.inspector.inventory : {});
}
// The living extension is authoritative. A legacy primitive names an intention,
// not evidence of arrival/work; legacy frames therefore use a neutral pose.
export function residentPose(r: Resident, f: WorldFrame, moving: boolean): Pose {
  const load=carried(r,f);
  if (moving || r.state === 'travel' || r.state === 'respond') return Object.values(load).some(n=>n>0) ? 'carry' : moving ? 'walk' : 'idle';
  if (r.state === 'fish' && r.tools?.includes('fish_line') && ['cast','wait','reel'].includes(r.phase ?? '')) return 'fish';
  if (r.state === 'sleep') return 'sleep';
  if (r.state === 'rest') return 'rest';
  const near=(q:{x:number;y:number})=>Math.max(Math.abs(q.x-r.x),Math.abs(q.y-r.y))<=1;
  const targetCrop=f.view.crops?.find(q=>q.x===r.target?.x&&q.y===r.target?.y&&near(q));
  if(r.state==='plant'&&r.phase==='plant'&&Object.keys(load).some(k=>cap(k,'plantable')&&(load[k]??0)>0))return 'plant';
  if(r.state==='tend'&&r.phase==='tend'&&targetCrop&&!targetCrop.ripe&&targetCrop.waterReachable)return 'tend';
  if(r.state==='harvest'&&r.phase==='harvest'&&targetCrop?.ripe)return 'harvest';
  if(r.state==='cook'&&r.phase==='cook'&&r.item&&cap(r.item,'heatable')&&(load[r.item]??0)>0&&f.view.fireState?.some(q=>near(q)&&q.x===r.target?.x&&q.y===r.target?.y&&q.fuel>=1.5))return 'cook';
  const workTool=r.tools?.some(t=>t==='hand_axe'||t==='stone_club');
  if (workTool && ((r.state === 'construct' && r.phase === 'construct' && (f.view.sites ?? []).some(s=>s.x===r.target?.x && s.y===r.target?.y && Object.values(s.materials).some(n=>n>0))) || (r.state === 'repair' && r.phase === 'repair' && Object.keys(load).some(k=>cap(k,'building')&&(load[k]??0)>0)))) return 'build';
  // Gathering is depicted from the ACTUAL target node and item, never from what
  // happens to be in hand: berry art requires a live bush in reach.
  if (r.state === 'gather' && r.phase === 'gather' && r.target) {
    const node=(f.view.nodes ?? []).find(([,,x,y])=>x===r.target!.x&&y===r.target!.y&&near({x,y}));
    if (node && node[4]>0) {
      if (r.item==='berry' && node[1]==='bush') return 'gather';
      if ((r.item==='wood'||r.item==='stick') && WOOD_NODES.has(node[1])) return workTool ? 'chop' : 'pickup';
      return 'work';
    }
  }
  // Stationary residents keep the held load visible without a walking/carry cycle.
  if ((load.wood ?? 0)>0 || (load.berry ?? 0)>0) return 'hold';
  return 'idle';
}
export function residentSprite(r: Resident, f: WorldFrame, moving: boolean, direction: string, phase: number): string {
  const pose=residentPose(r,f,moving), load=carried(r,f);
  const backward = direction === 'ne' || direction === 'nw';
  if (['plant','tend','harvest'].includes(pose)) return 'agency.kneel';
  if (pose==='fish') return r.phase==='cast' ? `fish.cast.${phase%2}` : r.phase==='wait' ? 'fish.wait' : 'fish.reel';
  if(pose==='sleep') return `rest.sleep.${phase%2}`;
  if(pose==='rest') return 'rest.settle';
  if(pose==='build') return phase%2 ? 'build.raise.0' : 'build.strike.0';
  if(pose==='gather') return ['gather.reach','gather.crouch','gather.lift'][phase%3];
  // Wood work: a held work tool swings; bare hands lift a piece from the stock.
  if(pose==='chop') return phase%2 ? 'build.raise.1' : 'build.strike.1';
  if(pose==='pickup') return phase%2 ? 'build.ready' : 'build.lower';
  if(pose==='carry'||pose==='hold') {
    if ((load.wood ?? 0)>0) return `carry.wood.${pose==='carry'?phase%2:0}`;
    if ((load.berry ?? 0)>0) return 'carry.berries';
    // No fabricated material substitute. The generic pouch is drawn separately.
  }
  // Supplied work/walk poses face SE only. Mirroring for SW is done at draw time;
  // backward travel retains its real rear view rather than pretending new frames exist.
  if((pose==='walk'||pose==='carry')&&!backward) return `walk.southeast.${phase%6}`;
  return backward ? (direction==='ne'?'idle.northeast':'idle.back') : direction==='sw'?'idle.southwest':'idle.southeast';
}
