import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceGeometry, projectSurface, pickSurface } from './surface';
import { terrainHeight, exposedFaces } from '../../../shared/relief.js';
import { clampCamera, DEFAULT_BOUNDS, viewportQuery } from './projection';
import type {WorldFrame} from './types';
function frame(x0:number,y0:number,w=12,h=12):WorldFrame{return {bounds:DEFAULT_BOUNDS,view:{x0,y0,w,h,tiles:Array(w*h).fill(0),biome:'temperate'}} as WorldFrame;}
test('defect 3: connected cliffs expose only drops; water banks and snow use real terrain kinds',()=>{
 assert.equal(exposedFaces(1.35,1.35,.18)[0],0);assert.ok(Math.abs(exposedFaces(1.35,1.35,.18)[1]-1.17)<1e-8);
 assert.ok(terrainHeight(5)>terrainHeight(4));assert.equal(terrainHeight(2),0);
 const f=frame(-32,-32),c={x:-28,y:-28,span:12},size={w:900,h:600};
 for(const [x,y] of [[-29,-29],[-28,-29],[-29,-28]])f.view.tiles[(y+32)*12+x+32]=7;
 const g=surfaceGeometry(f,-29,-29,c,size);
 assert.deepEqual(g.faces,[[],[]]);
 const e=surfaceGeometry(f,-28,-29,c,size);assert.ok(e.faces[0].length>4);
 assert.deepEqual(g.edges[1],e.edges[3].slice().reverse(),'shared curved top edge');
 const face=e.faces[0],p={x:face.reduce((n,v)=>n+v.x,0)/face.length,y:face.reduce((n,v)=>n+v.y,0)/face.length};
 assert.deepEqual(pickSurface(p,f,c,size),{x:-28,y:-29},'picking the visible cliff face selects its authoritative tile');
});
test('terrain picking and query cover all four corners, negative chunks, raised ground, zoom and aspect',()=>{
 let count=0;
 for(const size of [{w:320,h:720},{w:390,h:722},{w:667,h:253},{w:844,h:268},{w:1440,h:760}])for(const span of [9,16,32])for(const [x,y] of [[-112,-112],[167,-112],[-112,167],[167,167],[-28,-28],[-1,-1],[0,0],[28,28]])for(const kind of [0,5,6,7,9,2]){
  const c=clampCamera({x:x+.5,y:y+.5,span},DEFAULT_BOUNDS,size.w/size.h),q=viewportQuery(c,size.w/size.h),f=frame(q.x,q.y,q.w,q.h);
  f.view.tiles.fill(kind);const p=projectSurface({x:x+.5,y:y+.5},f,c,size);
  assert.ok(p.x>=0&&p.x<=size.w&&p.y>=0&&p.y<=size.h);
  assert.deepEqual(pickSurface(p,f,c,size),{x,y},`${x},${y} kind=${kind}`);count++;
 }
 assert.equal(count,720);
});
test('off-world and unknown terrain cannot be picked or invented by relief',()=>{
 const f=frame(0,0),c={x:6,y:6,span:12},size={w:800,h:600};
 assert.equal(pickSurface({x:0,y:0},f,c,size),null);
 const before=JSON.stringify(f);surfaceGeometry(f,4,4,c,size);assert.equal(JSON.stringify(f),before);
});

test('connected contour deforms the complete crest AND toe, with shared corners and exact picking',()=>{
 const f=frame(-8,-8,16,16),c={x:0,y:0,span:12},size={w:900,h:600};
 for(let y=-8;y<8;y++)for(let x=-8;x<8;x++)f.view.tiles[(y+8)*16+x+8]=x<0?7:6;
 const before=JSON.stringify(f),offsets:number[]=[];
 for(let y=-5;y<5;y++){
  const g=surfaceGeometry(f,-1,y,c,size),next=surfaceGeometry(f,-1,y+1,c,size),lower=surfaceGeometry(f,0,y,c,size);
  assert.deepEqual(g.edges[1].at(-1),next.edges[1][0],'crest segments join at one vertex');
  assert.equal(g.faces[0].length,14);
  const toe=g.faces[0].slice(7).reverse();
  const lowerEdge=lower.edges[3].slice().reverse();
  for(let i=0;i<7;i++){
   assert.ok(Math.abs(toe[i].x-lowerEdge[i].x)<1e-7&&Math.abs(toe[i].y-lowerEdge[i].y)<1e-7,'toe exactly meets lower curved surface');
   offsets.push(toe[i].x-(size.w/2-(y+i/6)*size.w/(2*c.span)));
  }
  const a=g.edges[1][3],b=toe[3];
  assert.deepEqual(pickSurface({x:(a.x+b.x)/2,y:(a.y+b.y)/2},f,c,size),{x:-1,y},'a click on a visible curved cliff face resolves to its real tile');
 }
 assert.ok(Math.max(...offsets)-Math.min(...offsets)>12,'the visible boundary genuinely meanders, not just a texture stripe');
 assert.equal(JSON.stringify(f),before);
});
test('contour mesh joins identical edges across corners, negative coordinates and streamed view overlap',()=>{
 const f=frame(-10,-10,20,20),other=frame(-6,-6,12,12),c={x:0,y:0,span:9},size={w:390,h:706};
 const kind=(x:number,y:number)=>(x<0&&y<2?6:x<2?5:3);
 for(const v of [f.view,other.view])for(let y=v.y0;y<v.y0+v.h;y++)for(let x=v.x0;x<v.x0+v.w;x++)v.tiles[(y-v.y0)*v.w+x-v.x0]=kind(x,y);
 for(let y=-3;y<3;y++)for(let x=-3;x<3;x++){
  const g=surfaceGeometry(f,x,y,c,size),east=surfaceGeometry(f,x+1,y,c,size),south=surfaceGeometry(f,x,y+1,c,size);
  assert.deepEqual(g.top,surfaceGeometry(other,x,y,c,size).top,'streamed view halo cannot change a visible contour');
  if(g.h===east.h)assert.deepEqual(g.edges[1],east.edges[3].slice().reverse());
  if(g.h===south.h)assert.deepEqual(g.edges[2],south.edges[0].slice().reverse());
 }
});
