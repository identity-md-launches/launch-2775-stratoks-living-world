import type { Art } from './art';
import { scale, type Size, type Point } from './projection';
import { tileAt, surfaceGeometry, projectSurface, heightAt as surfaceHeight } from './surface';
import { contourEdges, reuseContours } from './contours';
import type { Camera, WorldFrame } from './types';
export { tileAt } from './surface';
export const WATER=new Set([1,2,3,10]);
const COLORS=['#7d9b57','#4c9b9e','#307c90','#80b7af','#d8bf87','#9c9f8b','#e2e8df','#727e7a','#668750','#cdb17a','#5ca6a1'];
const noise=(x:number,y:number)=>((x*374761393+y*668265263)^((x+19)*(y+37)*1274126177))>>>0;
export function polygon(ctx:CanvasRenderingContext2D,points:Point[]) {
 ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();
}
export function diamond(ctx:CanvasRenderingContext2D,x:number,y:number,s:number){polygon(ctx,[{x,y:y-s/2},{x:x+s,y},{x,y:y+s/2},{x:x-s,y}]);}
export function heightOf(f:WorldFrame,x:number,y:number){const t=tileAt(f,x,y);return t<0?-1:surfaceHeight(f,x,y);}
export function drawTerrainTile(ctx:CanvasRenderingContext2D,art:Art,f:WorldFrame,x:number,y:number,c:Camera,size:Size) {
 const t=tileAt(f,x,y);if(t<0)return;
 const g=surfaceGeometry(f,x,y,c,size),p=g.p,s=scale(c,size),seed=noise(x,y),v8=seed%8;
 const biome=f.view.biomes?.[(y-f.view.y0)*f.view.w+x-f.view.x0]??f.view.biome;
 const faces=biome==='arid'?['#b88c58','#946b46']:biome==='cold'?['#8d9a99','#64787c']:biome==='coast'?['#879186','#586e6b']:['#89917c','#626e5c'];
 // Decoration noise depends on v8 (part of the cache key), never on raw x/y.
 const screen=(q:{x:number;y:number},lift=0)=>{const dx=q.x-x-.5,dy=q.y-y-.5;return {x:p.x+(dx-dy)*s,y:p.y+(dx+dy)*s/2+lift*s};};
 const nb=[[x,y-1],[x+1,y],[x,y+1],[x-1,y]].map(([nx,ny])=>({k:tileAt(f,nx,ny),h:heightOf(f,nx,ny)}));

 polygon(ctx,g.top);ctx.fillStyle=COLORS[t]??COLORS[0];ctx.fill();ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.65;ctx.stroke();
 ctx.save();polygon(ctx,g.top);ctx.clip();
 if(WATER.has(t)){
  ctx.fillStyle=t===2?'#164b6330':'#b4e4ce20';ctx.beginPath();ctx.ellipse(p.x,p.y,s*.6,s*.12,-.18,0,Math.PI*2);ctx.fill();
 }else{
  ctx.fillStyle=biome==='arid'?'#f5dcb118':biome==='cold'?'#ffffff20':'#b2bc7b20';ctx.fillRect(p.x-s*2,p.y-s,s*4,s*2);
  for(let n=0;n<8;n++){
   const h=noise(v8*23+n,v8*17-n),xx=p.x+((h%1000)/500-1)*s,yy=p.y+(((h>>>10)%1000)/1000-.5)*s;
   ctx.fillStyle=n%3?'#f5ebbb35':'#29452b25';ctx.beginPath();ctx.ellipse(xx,yy,s*.025+(h%3)*s*.012,s*.016,-.4,0,7);ctx.fill();
  }
  if((t===0||t===8)&&v8%3!==0){
   const xx=p.x+((v8%13)-6)*s*.05,yy=p.y+((v8%7)-3)*s*.04;
   ctx.strokeStyle='#354f3170';ctx.lineWidth=Math.max(.6,s*.018);ctx.beginPath();ctx.moveTo(xx-2,yy);ctx.lineTo(xx-4,yy-s*.12);ctx.moveTo(xx,yy);ctx.lineTo(xx+1,yy-s*.17);ctx.stroke();
  }
  if((t===4||t===9)&&v8%3===0){ctx.strokeStyle='#9f794d30';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(p.x,p.y+s*.15,s*.85,s*.23,-.2,Math.PI,Math.PI*2);ctx.stroke();}
  if(t===6&&v8%4===0){ctx.strokeStyle='#f7fcf1aa';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(p.x-s*.6,p.y+s*.1);ctx.quadraticCurveTo(p.x,p.y-s*.12,p.x+s*.6,p.y-s*.06);ctx.stroke();}
  if((t===5||t===7)&&v8%5===0){ctx.strokeStyle='#45595666';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.x-s*.5,p.y-s*.15);ctx.lineTo(p.x-s*.1,p.y+s*.08);ctx.lineTo(p.x+s*.15,p.y-s*.05);ctx.stroke();}
 }
 // Soften the material join on its actual curved edge. Both top polygons
 // already meet exactly; these translucent dabs do not define the silhouette.
 for(let i=0;i<4;i++){
  const n=nb[i];if(n.k<0||n.k===t||Math.abs(n.h-g.h)>.01)continue;
  const edge=g.edges[i],inner=edge.map(q=>({x:q.x+(p.x-q.x)*.18,y:q.y+(p.y-q.y)*.18}));
  polygon(ctx,[...edge,...inner.reverse()]);ctx.fillStyle=(COLORS[n.k]??COLORS[0])+'45';ctx.fill();
 }
 ctx.restore();
 // Top, toe and hit testing share the same joined contour. Large rock masses
 // are keyed to world distance along the run, not six repeated facets per tile.
 for(let side=0;side<2;side++){
  const face=g.faces[side];if(!face.length)continue;
  const n=nb[side+1],drop=g.drops[side],tall=drop>.3;
  ctx.save();polygon(ctx,face);ctx.clip();ctx.fillStyle=faces[side];ctx.fill();
  const line=side===0?x+1:y+1,u0=side===0?y:x;
  const at=(u:number,lower=0)=>{
   const whole=Math.floor(u),part=u-whole;
   let edge=contourEdges(f,side===0?x:x+whole,side===0?y+whole:y)[side+1];
   if(side===1)edge=edge.slice().reverse();
   const i=Math.min(5,Math.floor(part*6)),v=part*6-i,a=edge[i],b=edge[i+1];
   return screen({x:a.x+(b.x-a.x)*v,y:a.y+(b.y-a.y)*v},lower);
  };
  for(let band=Math.floor(u0/1.6)-1;band<=Math.floor((u0+1)/1.6)+1;band++){
   const h=noise(line*19+side,band*41),lo=band*1.6+(h%70)/100-u0,hi=lo+.7+((h>>>6)%100)/100;
   const a=at(lo),b=at(hi),d=at(lo+.25,drop),e=at(hi-.18,drop);
   polygon(ctx,[a,b,e,{x:(d.x+e.x)/2+s*.06,y:(d.y+e.y)/2-drop*s*.22},d]);
   ctx.fillStyle=mix(faces[side],((h%9)-4)*.045);ctx.fill();
   if(tall&&art.agencyTerrain){
    const row=biome==='arid'?1:biome==='cold'?2:biome==='coast'?3:0;
    ctx.save();polygon(ctx,[a,b,e,d]);ctx.clip();ctx.globalAlpha=.28;
    const left=Math.min(a.x,b.x,d.x,e.x),right=Math.max(a.x,b.x,d.x,e.x),top=Math.min(a.y,b.y);
    ctx.drawImage(art.agencyTerrain,row*40,0,40,64,left,top,right-left,Math.max(d.y,e.y)-top);ctx.restore();
   }
   if(tall&&h%3===0){const q=at(lo+.3,drop*.2),r=at(hi-.22,drop*.65);ctx.strokeStyle='#34434060';ctx.lineWidth=Math.max(.7,s*.025);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(r.x,r.y);ctx.stroke();}
  }
  ctx.restore();
  // One rim per exposed boundary, including its curved toe. No tile perimeter
  // strokes: neighbouring patches blend into a connected bank / rock outcrop.
  ctx.strokeStyle=t===6?'#f6faf6':t===7||t===5?'#c9cfc480':'#efe3b680';ctx.lineWidth=Math.max(.7,s*.025);ctx.beginPath();
  const crest=g.edges[side+1];crest.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));ctx.stroke();
  if(n.k>=0&&WATER.has(n.k)){
   ctx.strokeStyle='#d9eee29c';ctx.lineWidth=Math.max(.8,s*.035);ctx.beginPath();crest.forEach((q,i)=>i?ctx.lineTo(q.x,q.y+drop*s):ctx.moveTo(q.x,q.y+drop*s));ctx.stroke();
  }
 }

}
function mix(hex:string,k:number){
 const n=parseInt(hex.slice(1,7),16),f=(v:number)=>Math.max(0,Math.min(255,Math.round(k>0?v+(255-v)*k:v*(1+k))));
 return `rgb(${f(n>>16)},${f((n>>8)&255)},${f(n&255)})`;
}
// One DPR-capped viewport surface, no unbounded world/chunk cache. The signature
// excludes tick: unchanged terrain is reused while residents and signals animate.
export class GroundCache {
 private surface=document.createElement('canvas');
 private tiles=new Map<string,HTMLCanvasElement>();
 private occluderKeys=new Map<string,string>();
 private key='';private frame:WorldFrame|null=null;private signature='';
 builds=0;get size(){return this.key?1:0;}
 constructor(private art:Art){}
 private tile(f:WorldFrame,x:number,y:number){
  const coordinate=`${x},${y}`,known=this.occluderKeys.get(coordinate);
  const cached=known?this.tiles.get(known):undefined;
  if(cached)return cached;
  const kind=tileAt(f,x,y),biome=f.view.biomes?.[(y-f.view.y0)*f.view.w+x-f.view.x0]??f.view.biome;
  const g=surfaceGeometry(f,x,y,{x:x+.5,y:y+.5,span:1},{w:2,h:2});
  // The local two-tile halo includes corner continuation data. A changed or
  // newly streamed neighbour invalidates only the affected cached patches.
  const local=`${x},${y}:`+Array.from({length:25},(_,i)=>{const dx=i%5-2,dy=Math.floor(i/5)-2;return `${tileAt(f,x+dx,y+dy)}@${heightOf(f,x+dx,y+dy)}`;}).join(',');
  const key=`${kind}:${biome}:${g.h}:${g.drops}:${noise(x,y)%8}:${local}`;
  this.occluderKeys.set(coordinate,key);
  if(this.occluderKeys.size>384)this.occluderKeys.delete(this.occluderKeys.keys().next().value!);
  let tile=this.tiles.get(key);
  if(tile){this.tiles.delete(key);this.tiles.set(key,tile);}
  else{
   tile=document.createElement('canvas');tile.width=128;tile.height=160;
   const paint=tile.getContext('2d')!;
   // 32px per half tile, ample room for curved silhouette overhang on all sides.
   drawTerrainTile(paint,this.art,f,x,y,{x:x+.5,y:y+.5,span:2},{w:128,h:160});
   this.tiles.set(key,tile);
   if(this.tiles.size>384){const old=this.tiles.keys().next().value!;const canvas=this.tiles.get(old)!;canvas.width=canvas.height=0;this.tiles.delete(old);}
  }
  return tile;
 }
 drawOccluder(ctx:CanvasRenderingContext2D,f:WorldFrame,x:number,y:number,c:Camera,size:Size){
  const p=projectSurface({x:x+.5,y:y+.5},f,c,size),ratio=scale(c,size)/32,tile=this.tile(f,x,y);
  ctx.drawImage(tile,p.x-64*ratio,p.depth-80*ratio,128*ratio,160*ratio);
 }
 draw(ctx:CanvasRenderingContext2D,f:WorldFrame,c:Camera,size:Size,dpr=1){
  if(this.frame!==f){
   const v=f.view,signature=`${f.worldId}:${f.seed}:${v.x0}:${v.y0}:${v.w}:${v.h}:${v.tiles.join(',')}:${v.heights?.join(',')}:${v.biomes?.join(',')}`;
   if(this.frame&&signature===this.signature)reuseContours(this.frame,f);
   else this.occluderKeys.clear();
   this.signature=signature;this.frame=f;
  }
  const key=`${c.x},${c.y},${c.span},${size.w},${size.h},${dpr}:${this.signature}`;
  if(key!==this.key){
   this.surface.width=Math.ceil(size.w*dpr);this.surface.height=Math.ceil(size.h*dpr);
   const paint=this.surface.getContext('2d')!;paint.setTransform(dpr,0,0,dpr,0,0);
   paint.fillStyle='#8fa9a4';paint.fillRect(0,0,size.w,size.h);
   const v=f.view,s=scale(c,size);
   // Diagonal painter order, including at negative chunk boundaries.
   for(let sum=v.x0+v.y0;sum<=v.x0+v.w+v.y0+v.h-2;sum++)for(let y=Math.max(v.y0,sum-v.x0-v.w+1);y<=Math.min(v.y0+v.h-1,sum-v.x0);y++){
    const x=sum-y,g=surfaceGeometry(f,x,y,c,size);
    if(g.p.x+s*2<0||g.p.x-s*2>size.w||g.p.y+s*2<0||g.p.y-s/2>size.h)continue;
    drawTerrainTile(paint,this.art,f,x,y,c,size);
   }
   this.key=key;this.builds++;
  }
  ctx.drawImage(this.surface,0,0,this.surface.width,this.surface.height,0,0,size.w,size.h);
 }
}
