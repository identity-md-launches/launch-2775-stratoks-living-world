import { aggregatePiles, pileSizeClass } from '../../../shared/stockpiles.js';
import { tileAt } from './surface';
import { scale, type Size } from './projection';
import type { Camera, WorldFrame } from './types';
export type StockMember={key:string;kind:'pile'|'store';id:string|number;x:number;y:number;items:Record<string,number>;ruined?:boolean};
export type ResourceGroup={key:string;kind:'pile'|'store';x:number;y:number;items:Record<string,number>;units:number;size:number;cell:number;members:StockMember[]};
export type ResourceHit={key:string;x:number;y:number;r:number;depth:number};
export function resourceCell(c:Camera,size:Size){const s=scale(c,size);return s>=56?1:s>=40?2:s>=24?4:s>=14?8:16;}
export function stockMembers(f:WorldFrame):StockMember[]{
 return [...(f.view.piles??[]).map(p=>({...p,key:`pile:${p.id}`,kind:'pile' as const})),...(f.view.stores??[]).map(p=>({...p,id:p.shelter,key:`store:${p.shelter}`,kind:'store' as const}))].filter(p=>Object.values(p.items).some(n=>n>0));
}
function compatibility(f:WorldFrame,p:StockMember){
 const v=f.view,i=(p.y-v.y0)*v.w+p.x-v.x0;
 // Wood-bearing, stone-bearing and other piles stay separate, as do terrain
 // banks and shelter stores. Mixed piles retain every secondary item.
 const material=p.items.wood>0?'wood':p.items.stone>0?'stone':'other';
 return `${p.kind}:${p.ruined?'ruin':'usable'}:${tileAt(f,p.x,p.y)}:${v.biomes?.[i]??v.biome}:${material}`;
}
/** Presentation groups only. Every positive stock remains exactly once, with its
 * original id, coordinate and full item map. The marker sits on a REAL member. */
export function resourceGroups(f:WorldFrame,c:Camera,size:Size):ResourceGroup[]{
 const cell=resourceCell(c,size),members=stockMembers(f),by=new Map<string,StockMember[]>();
 // Use server's four-tile membership when supplied. Larger groups coarsen it;
 // older frames fall back to the same pure aggregation of the exact piles.
 const clusters=f.view.pileClusters?.v===1&&f.view.pileClusters.cell===4?f.view.pileClusters.clusters:aggregatePiles(f.view.piles??[],4);
 const membership=new Map<string,string>();
 if(cell===4)for(const group of clusters)for(const p of group.members)membership.set(String(p.id),group.key);
 for(const p of members){
  const region=cell===1?p.key:(p.kind==='pile'&&cell===4?membership.get(String(p.id)):undefined)??`${Math.floor(p.x/cell)},${Math.floor(p.y/cell)}`;
  const key=`${cell}:${region}:${compatibility(f,p)}`;
  const group=by.get(key);if(group)group.push(p);else by.set(key,[p]);
 }
 return [...by].map(([key,ps])=>{
  const items:Record<string,number>={};let units=0,x=0,y=0;
  for(const p of ps){let weight=0;for(const [k,n] of Object.entries(p.items))if(n>0){items[k]=(items[k]??0)+n;weight+=n;}units+=weight;x+=p.x*weight;y+=p.y*weight;}
  x/=units;y/=units;
  const anchor=ps.reduce((a,p)=>Math.hypot(p.x-x,p.y-y)<Math.hypot(a.x-x,a.y-y)?p:a);
  return {key,kind:anchor.kind,x:anchor.x,y:anchor.y,items,units,size:pileSizeClass(units),cell,members:ps};
 });
}
