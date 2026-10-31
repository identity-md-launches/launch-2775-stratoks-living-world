import { exposedFaces } from '../../../shared/relief.js';
import { project, unproject, scale, type Point, type Size } from './projection';
import type { Camera, WorldFrame } from './types';
import { tileAt, heightAt, contourEdges } from './contours';
export { tileAt, heightAt } from './contours';
export function projectSurface(p: Point, f: WorldFrame, c: Camera, size: Size, height=heightAt(f,Math.floor(p.x),Math.floor(p.y))) {
  const q=project(p,c,size);
  return {x:q.x,y:q.y-height*scale(c,size),depth:q.y};
}
export function surfaceGeometry(f: WorldFrame, x: number, y: number, c: Camera, size: Size) {
  const h=heightAt(f,x,y), s=scale(c,size), p=projectSurface({x:x+.5,y:y+.5},f,c,size,h);
  const edges=contourEdges(f,x,y).map(edge=>edge.map(q=>projectSurface(q,f,c,size,h)));
  const top=edges.flatMap(edge=>edge.slice(0,-1));
  // Missing viewport neighbours are unknown, not an invented drop. World edges
  // are explicit outer faces. Queries include a halo so visible edges are known.
  const neighbor=(nx:number,ny:number)=>tileAt(f,nx,ny)<0 && nx>=f.bounds.x0 && ny>=f.bounds.y0 && nx<f.bounds.x1 && ny<f.bounds.y1 ? h : heightAt(f,nx,ny);
  const drops=exposedFaces(h,neighbor(x+1,y),neighbor(x,y+1));
  const faces=drops.map((d,i)=>d ? [...edges[i+1],...edges[i+1].slice().reverse().map(q=>({x:q.x,y:q.y+d*s}))] : []);
  return {p,h,top,faces,edges,drops};
}
function contains(p: Point, poly: Point[]) {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
// Reverse of the SAME top/face geometry and painter order used by the renderer.
// A bounded 7×7 ray neighbourhood suffices for the 1.35-half-tile maximum lift.
export function pickSurface(p: Point, f: WorldFrame, c: Camera, size: Size): Point | null {
  const flat=unproject(p,c,size), candidates:{x:number;y:number;depth:number}[]=[];
  for(let y=Math.floor(flat.y)-3;y<=Math.floor(flat.y)+3;y++)for(let x=Math.floor(flat.x)-3;x<=Math.floor(flat.x)+3;x++) {
    if(tileAt(f,x,y)<0)continue;
    const g=surfaceGeometry(f,x,y,c,size);
    if(contains(p,g.top)||g.faces.some(face=>face.length&&contains(p,face)))candidates.push({x,y,depth:x+y});
  }
  candidates.sort((a,b)=>b.depth-a.depth || b.x-a.x);
  return candidates.length ? {x:candidates[0].x,y:candidates[0].y}:null;
}
