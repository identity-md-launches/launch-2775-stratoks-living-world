import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import type { ResourceGroup } from './resources';
const items=(value:Record<string,number>)=>Object.entries(value).filter(([,n])=>n>0).map(([k,n])=>`${n} ${k.replaceAll('_',' ')}`).join(', ');
export function ResourceEvidence({groups,selected,tick,close,onTile}:{groups:ResourceGroup[];selected:string|null;tick:number;close:()=>void;onTile:(p:{x:number;y:number})=>void}){
 const ref=useRef<HTMLDialogElement>(null),[key,setKey]=useState(selected);
 const group=groups.find(g=>g.key===key);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current!.showModal();return()=>{ref.current?.close();previous?.focus({preventScroll:true});};},[]);
 return <dialog ref={ref} className="exp-tile-evidence exp-resource-evidence" aria-label="Resource evidence" onKeyDown={e=>{if(e.key==='Escape')e.stopPropagation();}} onCancel={e=>{e.preventDefault();close();}}>
  <div className="exp-tile-head"><h2>Resource evidence</h2><button className="exp-icon" aria-label="Close resource evidence" onClick={close}><Icon name="close" size={16}/></button></div>
  <div className="exp-tile-body">
   {key!==null&&<button className="exp-button" onClick={()=>setKey(null)}>All visible groups</button>}
   {group?<>
    <h3>{group.kind==='store'?'Shelter stores':'Ground piles'} · {group.members.length} {group.members.length===1?'location':'locations'}</h3>
    <p className="exp-stock-total">{items(group.items)}</p>
    <p className="exp-small exp-muted">Marker at {group.x}, {group.y}. Each location below keeps its own stock.</p>
    <ul className="exp-stock-members">{group.members.map(m=><li key={m.key} data-stock-id={m.key}>
     <strong>{m.kind==='store'?`Store #${m.id}`:`Pile ${m.id}`}{m.ruined?' · ruined':''}</strong>
     <p>{items(m.items)}</p>
     <button className="exp-button" onClick={()=>onTile(m)}>Inspect tile {m.x}, {m.y}</button>
    </li>)}</ul>
   </>:<>
    {key!==null&&<p role="status">This group changed as the world advanced. Select its current stock below.</p>}
    <p className="exp-small exp-muted">{groups.length} groups anchored in view. Zoom in to separate piles; select a group for exact contents and every location.</p>
    {groups.length?<ul className="exp-stock-groups">{groups.map(g=><li key={g.key}><button onClick={()=>setKey(g.key)}>
     <strong>{g.kind==='store'?'Stores':'Piles'} · {g.x}, {g.y}</strong>
     <span>{g.members.length} {g.members.length===1?'location':'locations'} · {items(g.items)}</span>
    </button></li>)}</ul>:<p>No stored resources in view. Pan toward a settlement or zoom out.</p>}
   </>}
   <p className="exp-small exp-muted">Received tick {tick.toLocaleString()}. Observer evidence; residents use their own local knowledge.</p>
  </div>
 </dialog>;
}
