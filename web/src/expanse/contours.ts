import { terrainHeight } from '../../../shared/relief.js';
import type { Point } from './projection';
import type { WorldFrame } from './types';

export function tileAt(f: WorldFrame, x: number, y: number) {
  const v=f.view;
  return x>=v.x0&&y>=v.y0&&x<v.x0+v.w&&y<v.y0+v.h ? v.tiles[(y-v.y0)*v.w+x-v.x0] : -1;
}
export function heightAt(f: WorldFrame, x: number, y: number) {
  const t=tileAt(f,x,y),v=f.view;
  return t<0?0:v.heights?.[(y-v.y0)*v.w+x-v.x0]??terrainHeight(t);
}
const noise=(x:number,y:number)=>((x*374761393+y*668265263)^((x+19)*(y+37)*1274126177))>>>0;
const smooth=(x:number,y:number,period:number,salt:number)=>{
  x/=period;y/=period;const X=Math.floor(x),Y=Math.floor(y),u=x-X,v=y-Y,a=u*u*(3-2*u),b=v*v*(3-2*v);
  const n=(dx:number,dy:number)=>(noise(X+dx+salt,Y+dy)%2001)/1000-1;
  return (n(0,0)*(1-a)+n(1,0)*a)*(1-b)+(n(0,1)*(1-a)+n(1,1)*a)*b;
};
// One shared mesh per received view. It changes presentation only; tile indices,
// heights, pathfinding, resident anchors and inventories never change.
const caches=new WeakMap<WorldFrame['view'],{vertices:Map<string,Point>;edges:Map<string,Point[]>}>();
function cache(f:WorldFrame){let c=caches.get(f.view);if(!c)caches.set(f.view,c={vertices:new Map(),edges:new Map()});return c;}
// GroundCache calls this only after comparing complete terrain signatures.
// Polling changes resident/stock state, but must not rebuild an unchanged mesh.
export function reuseContours(from:WorldFrame,to:WorldFrame){caches.set(to.view,cache(from));}
function material(f:WorldFrame,x:number,y:number){return `${tileAt(f,x,y)}:${heightAt(f,x,y)}`;}
function vertex(f:WorldFrame,x:number,y:number):Point {
  const c=cache(f),key=`${x},${y}`,old=c.vertices.get(key);if(old)return old;
  const tiles=[[x-1,y-1],[x,y-1],[x,y],[x-1,y]],kinds=tiles.map(([a,b])=>material(f,a,b));
  let dx=0,dy=0;
  // A three-to-one corner is pulled toward the isolated material. The joined
  // boundary's cubic tangent then rounds the stair step without leaving a hole.
  for(let i=0;i<4;i++)if(kinds.filter(k=>k===kinds[i]).length===1&&kinds.filter(k=>k===kinds[(i+1)%4]).length===3){dx=(tiles[i][0]+.5-x)*.38;dy=(tiles[i][1]+.5-y)*.38;}
  const clamp=(v:number)=>Math.max(-.46,Math.min(.46,v));
  const vertical=kinds[0]!==kinds[1]||kinds[3]!==kinds[2],horizontal=kinds[0]!==kinds[3]||kinds[1]!==kinds[2];
  // Each connected bank has its own phase, so neighbouring long geological
  // bands do not inherit parallel waves. The +/- .46 bound keeps tile centres
  // and narrow passages on their original side of the visual boundary.
  const wave=(line:number,u:number,salt:number)=>smooth(line*17,u,3,salt)*.64+smooth(line*29,u,1.3,salt+47)*.2;
  const p={x:x+clamp((vertical?wave(x,y,71):smooth(x,y,7,71)*.12)+dx),y:y+clamp((horizontal?wave(y,x,211):smooth(x,y,8,211)*.12)+dy)};
  c.vertices.set(key,p);return p;
}
// Canonical horizontal/vertical edge. All callers use the same ordered points.
function pair(f:WorldFrame,x:number,y:number,axis:number){
  const a=material(f,x,y),b=axis?material(f,x-1,y):material(f,x,y-1);
  return a===b?null:[a,b].sort().join('|');
}
function continuation(f:WorldFrame,x:number,y:number,other:Point,wanted:string):Point|null {
  const edges=[{x,y,axis:0,end:{x:x+1,y}},{x:x-1,y,axis:0,end:{x:x-1,y}},{x,y,axis:1,end:{x,y:y+1}},{x,y:y-1,axis:1,end:{x,y:y-1}}];
  const next=edges.filter(e=>(e.end.x!==other.x||e.end.y!==other.y)&&pair(f,e.x,e.y,e.axis)===wanted);
  return next.length===1?vertex(f,next[0].end.x,next[0].end.y):null;
}
function edge(f:WorldFrame,x:number,y:number,axis:0|1):Point[]{
  const c=cache(f),key=`${axis}:${x},${y}`,old=c.edges.get(key);if(old)return old;
  const end={x:x+(axis?0:1),y:y+(axis?1:0)},a=vertex(f,x,y),b=vertex(f,end.x,end.y),kind=pair(f,x,y,axis);
  const prev=kind?continuation(f,x,y,end,kind):null,next=kind?continuation(f,end.x,end.y,{x,y},kind):null;
  const u=prev?{x:a.x+(b.x-prev.x)/6,y:a.y+(b.y-prev.y)/6}:{x:a.x+(b.x-a.x)/3,y:a.y+(b.y-a.y)/3};
  const v=next?{x:b.x-(next.x-a.x)/6,y:b.y-(next.y-a.y)/6}:{x:b.x-(b.x-a.x)/3,y:b.y-(b.y-a.y)/3};
  const points=Array.from({length:7},(_,i)=>{const t=i/6,q=1-t;return {x:q*q*q*a.x+3*q*q*t*u.x+3*q*t*t*v.x+t*t*t*b.x,y:q*q*q*a.y+3*q*q*t*u.y+3*q*t*t*v.y+t*t*t*b.y};});
  c.edges.set(key,points);return points;
}
/** Clockwise tile boundary: north, east, south, west. Shared edges reverse exactly. */
export function contourEdges(f:WorldFrame,x:number,y:number):Point[][]{
  return [edge(f,x,y,0),edge(f,x+1,y,1),edge(f,x,y+1,0).slice().reverse(),edge(f,x,y,1).slice().reverse()];
}
