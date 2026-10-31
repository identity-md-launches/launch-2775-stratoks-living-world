import type { Art } from './art';
import { scale, type Size, type Point } from './projection';
import { tileAt, surfaceGeometry, heightAt as surfaceHeight } from './surface';
import type { Camera, WorldFrame } from './types';
export { tileAt } from './surface';
export const WATER=new Set([1,2,3,10]);
const COLORS=['#7d9b57','#4c9b9e','#307c90','#80b7af','#d8bf87','#9c9f8b','#e2e8df','#727e7a','#668750','#cdb17a','#5ca6a1'];
const noise=(x:number,y:number)=>((x*374761393+y*668265263)^((x+19)*(y+37)*1274126177))>>>0;
export function polygon(ctx:CanvasRenderingContext2D,points:Point[]) {
 ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();
}
export function diamond(ctx:CanvasRenderingContext2D,x:number,y:number,s:number){polygon(ctx,[{x,y:y-s/2},{x:x+s,y},{x,y:y+s/2},{x:x-s,y}]);}
function dropForTexture(face:Point[]){return face[3].y-face[0].y;}
// Organic contours. A boundary LINE carries one smooth meander (value noise
// along the line, ~5-tile period), so long straight runs bend continuously
// across tiles; it tapers to the vertex only where the boundary turns. Both
// tiles paint only their own side of it (their top is the clip). Geometry,
// heights, walkability and picking remain the authoritative tile mesh.
const lattice=(axis:number,line:number,k:number)=>(noise(line*7+axis*131071,k*13-axis*7919)%2001)/1000-1;
const smooth=(axis:number,line:number,u:number,period:number)=>{
 const q=u/period,k=Math.floor(q),f=q-k,w=f*f*(3-2*f);return lattice(axis,line+period*977,k)*(1-w)+lattice(axis,line+period*977,k+1)*w;
};
export function meander(axis:0|1,line:number,u:number){
 return Math.max(-.44,Math.min(.44,smooth(axis,line,u,5)*.34+smooth(axis,line+31,u,2)*.13));
}
// Edge i of tile (x,y): 0 → (x,y-1), 1 → (x+1,y), 2 → (x,y+1), 3 → (x-1,y).
// Returns world points for parameter t and the signed offset INTO this tile.
function edgeOf(f:WorldFrame,x:number,y:number,i:number){
 const axis=(i%2) as 0|1,X=i===1?x+1:x,Y=i===2?y+1:y,into=i===0||i===3?1:-1;
 const [nx,ny]=[[x,y-1],[x+1,y],[x,y+1],[x-1,y]][i],a=tileAt(f,x,y),b=tileAt(f,nx,ny);
 const [ux,uy]=axis?[0,1]:[1,0];
 const runs=(d:number)=>tileAt(f,x+ux*d,y+uy*d)===a&&tileAt(f,nx+ux*d,ny+uy*d)===b;
 const r0=runs(-1),r1=runs(1),ease=(v:number)=>{const c=Math.max(0,Math.min(1,v/.5));return c*c*(3-2*c);};
 const line=axis?X:Y,u0=axis?y:x;
 const d=(t:number)=>meander(axis,line,u0+t)*(r0?1:ease(t))*(r1?1:ease(1-t));
 const at=(t:number,off:number)=>axis?{x:X+off*into,y:y+t}:{x:x+t,y:Y+off*into};
 return {id:noise(line,u0)%8,inward:(t:number)=>d(t)*into,at};
}
const DIAG=[[-1,-1],[1,-1],[1,1],[-1,1]];
export function heightOf(f:WorldFrame,x:number,y:number){const t=tileAt(f,x,y);return t<0?-1:surfaceHeight(f,x,y);}
export function drawTerrainTile(ctx:CanvasRenderingContext2D,art:Art,f:WorldFrame,x:number,y:number,c:Camera,size:Size) {
 const t=tileAt(f,x,y);if(t<0)return;
 const g=surfaceGeometry(f,x,y,c,size),p=g.p,s=scale(c,size),seed=noise(x,y),v8=seed%8;
 const biome=f.view.biomes?.[(y-f.view.y0)*f.view.w+x-f.view.x0]??f.view.biome;
 const faces=biome==='arid'?['#b88c58','#946b46']:biome==='cold'?['#8d9a99','#64787c']:biome==='coast'?['#879186','#586e6b']:['#89917c','#626e5c'];
 // Decoration noise depends on v8 (part of the cache key), never on raw x/y.
 const screen=(q:{x:number;y:number},lift=0)=>{const dx=q.x-x-.5,dy=q.y-y-.5;return {x:p.x+(dx-dy)*s,y:p.y+(dx+dy)*s/2+lift*s};};
 const nb=[[x,y-1],[x+1,y],[x,y+1],[x-1,y]].map(([nx,ny])=>({k:tileAt(f,nx,ny),h:heightOf(f,nx,ny)}));
 const N=24;
 polygon(ctx,g.top);ctx.fillStyle=COLORS[t]??COLORS[0];ctx.fill();ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.65;ctx.stroke();
 ctx.save();polygon(ctx,g.top);ctx.clip();
 if(WATER.has(t)){
  ctx.fillStyle=t===2?'#164b6330':'#b4e4ce20';ctx.beginPath();ctx.ellipse(p.x,p.y,s*.6,s*.12,-.18,0,Math.PI*2);ctx.fill();
 }else{
  ctx.fillStyle=biome==='arid'?'#f5dcb118':biome==='cold'?'#ffffff20':'#b2bc7b20';ctx.fillRect(p.x-s,p.y-s/2,s*2,s);
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
 // Material transitions on the top surface.
 for(let i=0;i<4;i++){
  const n=nb[i];if(n.k<0||n.k===t)continue;
  const e=edgeOf(f,x,y,i),same=Math.abs(n.h-g.h)<.01,lowerBehind=n.h<g.h&&(i===0||i===3),higherBehind=n.h>g.h&&(i===0||i===3);
  if(!same&&!lowerBehind&&!higherBehind)continue;
  // Same height: the shared wave. Lower neighbour behind: the bank erodes inward
  // (its drop faces away from the viewer). Higher neighbour behind: talus/foam.
  const scree=higherBehind&&n.h-g.h>.3;
  const off=(u:number)=>same?e.inward(u):Math.abs(e.inward(u))*(higherBehind?(scree?1.1:.8):1)+(higherBehind?(scree?.16:.08):.05);
  ctx.beginPath();
  for(let k=0;k<=N;k++){const q=screen(e.at(k/N,0));k?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);}
  for(let k=N;k>=0;k--){const q=screen(e.at(k/N,off(k/N)));ctx.lineTo(q.x,q.y);}
  ctx.closePath();
  ctx.fillStyle=higherBehind?(WATER.has(t)?'#9fcfc2c8':mix(COLORS[t],-.18)):COLORS[n.k]??COLORS[0];ctx.fill();
  if(higherBehind&&!WATER.has(t))for(let k=0;k<(scree?10:6);k++){const h=noise(v8*41+i*5+k,e.id*3+k),u=.05+k*(scree?.095:.16),q=screen(e.at(u,(Math.abs(e.inward(u))*.9+.05)*((h>>>4)%100)/100));ctx.fillStyle=mix(faces[1],(h%5)*.05-.08);ctx.strokeStyle='#2d3b3a55';ctx.lineWidth=.6;ctx.beginPath();ctx.ellipse(q.x,q.y,s*(.05+(h%3)*(scree?.04:.025)),s*(scree?.05:.035),0,0,7);ctx.fill();ctx.stroke();}
  if(!same){ // bank lip / foam line traced along the irregular contour
   ctx.strokeStyle=higherBehind?'#ffffffa0':WATER.has(n.k)?'#eef6e6c8':'#3e3a2e70';ctx.lineWidth=Math.max(.7,s*.03);ctx.beginPath();
   for(let k=0;k<=N;k++){const q=screen(e.at(k/N,off(k/N)));k?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);}ctx.stroke();
  }
  // Wider irregular transition: scattered dabs of the neighbouring material.
  if(same&&!WATER.has(t)&&!WATER.has(n.k))for(let k=0;k<5;k++){
   const h=noise(v8*31+i*7+k,e.id*29-k),u=.1+(h%800)/1000,depth=.06+((h>>>11)%100)/100*.24,q=screen(e.at(u,depth+Math.max(0,e.inward(u))));
   ctx.fillStyle=(COLORS[n.k]??COLORS[0])+'b0';ctx.beginPath();ctx.ellipse(q.x,q.y,s*(.05+(h%5)*.012),s*(.03+(h%3)*.008),-.4,0,7);ctx.fill();
  }
 }
 // Round stair-step corners where both edge neighbours and the diagonal share one material.
 const corners=[[3,0],[0,1],[1,2],[2,3]],vertex=[{x,y},{x:x+1,y},{x:x+1,y:y+1},{x,y:y+1}];
 for(let v=0;v<4;v++){
  const [a,b]=corners[v],na=nb[a],nbb=nb[b],dk=tileAt(f,x+DIAG[v][0],y+DIAG[v][1]);
  if(na.k<0||na.k===t||na.k!==nbb.k||dk!==na.k)continue;
  const ok=Math.abs(na.h-g.h)<.01&&Math.abs(nbb.h-g.h)<.01||(v===0&&na.h<g.h&&nbb.h<g.h);
  if(!ok)continue;
  const q=screen(vertex[v]),r=.42*s*Math.SQRT2;
  ctx.fillStyle=COLORS[na.k]??COLORS[0];ctx.beginPath();ctx.ellipse(q.x,q.y,r,r/2,0,0,7);ctx.fill();
  if(v===0&&na.h<g.h){ctx.strokeStyle=WATER.has(na.k)?'#eef6e6c8':'#3e3a2e70';ctx.lineWidth=Math.max(.7,s*.03);ctx.beginPath();ctx.ellipse(q.x,q.y,r,r/2,0,0,Math.PI);ctx.stroke();}
 }
 ctx.restore();
 // Exposed faces with an irregular crest (inward only) down to the true toe.
 for(let side=0;side<2;side++){
  const face=g.faces[side];if(!face.length)continue;
  const i=side+1,n=nb[i],e=edgeOf(f,x,y,i),drop=dropForTexture(face)/s,tall=drop>.3;
  // Tall faces: a jagged skyline of spurs and gullies (per-facet jag, shared at
  // the tile ends so adjacent cliff tiles stay joined).
  const jag=(u:number)=>tall?Math.sin(Math.PI*u)*(((noise(v8*7+side,e.id+Math.floor(u*7))%100)/100)-.3)*.16:0;
  const crest=(u:number)=>screen(e.at(u,Math.abs(e.inward(u))*(tall?1:.6)+(tall?.07:.03)+jag(u)));
  const toe=(u:number)=>screen(e.at(u,0),drop);
  // Facets: irregular breakpoints, each a quad with its own tone.
  const cuts=[0];for(let k=1;k<6;k++){const h=noise(v8*13+side*3+k,e.id*11+k);cuts.push(k/6+((h%100)/100-.5)*.09);}cuts.push(1);
  for(let k=0;k<cuts.length-1;k++){
   const u0=cuts[k],u1=cuts[k+1],h=noise(v8*5+k+side*17,e.id*7-k);
   ctx.beginPath();const steps=4;
   for(let j=0;j<=steps;j++){const q=crest(u0+(u1-u0)*j/steps);j?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);}
   const b1=toe(u1),b0=toe(u0);ctx.lineTo(b1.x,b1.y);ctx.lineTo(b0.x,b0.y);ctx.closePath();
   const tone=((h%9)-4)*.025*(tall?1.4:1);
   ctx.fillStyle=mix(faces[side],tone);ctx.fill();ctx.strokeStyle=mix(faces[side],tone-.08);ctx.lineWidth=.6;ctx.stroke();
   if(tall&&h%3===0){ // a diagonal fracture, never a horizontal stripe
    const a=crest(u0+(u1-u0)*.3),bq=toe(u0+(u1-u0)*.7);ctx.strokeStyle='#2d3b3a55';ctx.lineWidth=Math.max(.7,s*.025);
    ctx.beginPath();ctx.moveTo(a.x,a.y+(bq.y-a.y)*.2);ctx.lineTo((a.x+bq.x)/2+s*.05,(a.y+bq.y)/2);ctx.lineTo(bq.x,bq.y-(bq.y-a.y)*.15);ctx.stroke();
   }
  }
  if(art.agencyTerrain&&drop>.1){
   ctx.save();ctx.beginPath();for(let k=0;k<=N;k++){const q=crest(k/N);k?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);}
   for(let k=N;k>=0;k--){const q=toe(k/N);ctx.lineTo(q.x,q.y);}ctx.closePath();ctx.clip();ctx.globalAlpha=t===7?.2:.1;
   const row=biome==='arid'?1:biome==='cold'?2:biome==='coast'?3:0;
   const left=Math.min(...face.map(q=>q.x)),top=Math.min(...face.map(q=>q.y))-s*.3,bottom=Math.max(...face.map(q=>q.y));
   ctx.drawImage(art.agencyTerrain,row*40,0,40,64,left,top,s,bottom-top);ctx.restore();
  }
  // Crest lip: grass/snow overhang tufts on soft ground, a light rim on rock.
  ctx.strokeStyle=t===6?'#f6faf6':t===7||t===5?'#c9cfc4a0':'#efe3b690';ctx.lineWidth=Math.max(.8,s*.035);ctx.beginPath();
  for(let k=0;k<=N;k++){const q=crest(k/N);k?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);}ctx.stroke();
  if(t===0||t===8||t===6)for(let k=0;k<4;k++){const h=noise(v8*3+k+side*5,e.id*5+k),q=crest(.12+k*.24+(h%10)/100);ctx.fillStyle=t===6?'#eef4f0':mix(COLORS[t],-.12);ctx.beginPath();ctx.ellipse(q.x,q.y+s*.03,s*.09,s*.05+(h%3)*s*.01,0,0,Math.PI);ctx.fill();}
  // Toe: boulders on rock faces, foam scallops against water.
  for(let k=0;k<(tall?4:2);k++){
   const h=noise(v8*17+k+side*9,e.id*19-k),u=.1+((h%800)/1000),q=toe(u);
   if(n.k>=0&&WATER.has(n.k)){ctx.fillStyle='#eef6e6b0';ctx.beginPath();ctx.ellipse(q.x,q.y-s*.03,s*(.1+(h%4)*.02),s*.035,0,Math.PI,0);ctx.fill();}
   else if(tall||t===5){ctx.fillStyle=mix(faces[1],(h%5)*.03);ctx.strokeStyle='#2d3b3a66';ctx.lineWidth=.6;ctx.beginPath();ctx.ellipse(q.x,q.y-s*.06,s*(.07+(h%4)*.02),s*.05,0,0,7);ctx.fill();ctx.stroke();}
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
 private key='';private frame:WorldFrame|null=null;private signature='';
 builds=0;get size(){return this.key?1:0;}
 constructor(private art:Art){}
 private tile(f:WorldFrame,x:number,y:number){
  const kind=tileAt(f,x,y),biome=f.view.biomes?.[(y-f.view.y0)*f.view.w+x-f.view.x0]??f.view.biome;
  const g=surfaceGeometry(f,x,y,{x:x+.5,y:y+.5,span:1},{w:2,h:2});
  const around=[[x,y-1],[x+1,y],[x,y+1],[x-1,y]].map(([nx,ny])=>tileAt(f,nx,ny)),diag=DIAG.map(([dx,dy])=>tileAt(f,x+dx,y+dy));
  const plain=around.every(k=>k===kind||k<0)&&diag.every(k=>k===kind||k<0);
  // Unique noise only matters where an edge actually carries a contour.
  const nbs=[[x,y-1],[x+1,y],[x,y+1],[x-1,y]] as [number,number][];
  // Contour tiles are unique (a continuous meander); interior tiles share variants.
  const local=plain?'':`${x},${y}:${around.map((k,i)=>`${k}@${heightOf(f,...nbs[i])}`)}:${diag}`;
  const key=`${kind}:${biome}:${g.h}:${g.faces.map(face=>face.length?face[3].y-face[0].y:0)}:${noise(x,y)%8}:${local}`;
  let tile=this.tiles.get(key);
  if(tile){this.tiles.delete(key);this.tiles.set(key,tile);}
  else{
   tile=document.createElement('canvas');tile.width=68;tile.height=128;
   const paint=tile.getContext('2d')!;
   // 32px per half tile, top at y=64-height*32. Faces fit below.
   drawTerrainTile(paint,this.art,f,x,y,{x:x+.5,y:y+.5,span:68/64},{w:68,h:128});
   this.tiles.set(key,tile);
   if(this.tiles.size>1024){const old=this.tiles.keys().next().value!;const canvas=this.tiles.get(old)!;canvas.width=canvas.height=0;this.tiles.delete(old);}
  }
  return tile;
 }
 draw(ctx:CanvasRenderingContext2D,f:WorldFrame,c:Camera,size:Size,dpr=1){
  if(this.frame!==f){const v=f.view;this.signature=`${f.worldId}:${f.seed}:${v.x0}:${v.y0}:${v.w}:${v.h}:${v.tiles.join('')}:${v.heights?.join(',')}:${v.biomes?.join(',')}`;this.frame=f;}
  const key=`${c.x},${c.y},${c.span},${size.w},${size.h},${dpr}:${this.signature}`;
  if(key!==this.key){
   this.surface.width=Math.ceil(size.w*dpr);this.surface.height=Math.ceil(size.h*dpr);
   const paint=this.surface.getContext('2d')!;paint.setTransform(dpr,0,0,dpr,0,0);
   paint.fillStyle='#8fa9a4';paint.fillRect(0,0,size.w,size.h);
   const v=f.view,s=scale(c,size);
   // Diagonal painter order, including at negative chunk boundaries.
   for(let sum=v.x0+v.y0;sum<=v.x0+v.w+v.y0+v.h-2;sum++)for(let y=Math.max(v.y0,sum-v.x0-v.w+1);y<=Math.min(v.y0+v.h-1,sum-v.x0);y++){
    const x=sum-y,g=surfaceGeometry(f,x,y,c,size);
    if(g.p.x+s<0||g.p.x-s>size.w||g.p.y+s*2<0||g.p.y-s/2>size.h)continue;
    const tile=this.tile(f,x,y),ratio=s/32;paint.drawImage(tile,g.p.x-34*ratio,g.p.depth-64*ratio,68*ratio,128*ratio);
   }
   this.key=key;this.builds++;
  }
  ctx.drawImage(this.surface,0,0,this.surface.width,this.surface.height,0,0,size.w,size.h);
 }
}
