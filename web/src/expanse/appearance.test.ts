import test from 'node:test';
import assert from 'node:assert/strict';
import { residentPose,residentSprite,constructionStage } from './appearance';
import type {WorldFrame,Resident} from './types';
const r:Resident={id:42,name:'Test resident',x:28,y:-1,health:80,action:null};
const f={inspector:null,view:{sites:[]}} as unknown as WorldFrame;
test('primitive intentions cannot make a false work/rest/fishing pose',()=>{
 for(const action of ['gather','rest','build','repair','carry','fish'])assert.equal(residentPose({...r,action},f,false),'idle');
 assert.equal(residentPose({...r,action:'rest',state:'travel'},f,true),'walk');
 assert.equal(residentPose({...r,state:'sleep'},f,false),'sleep');
 assert.equal(residentPose({...r,state:'rest'},f,false),'rest');
});
test('fishing casts only with actual phase and obtainable line; no catch frame is invented',()=>{
 const fishing={...r,action:'gather',state:'fish',phase:'cast',tools:['fish_line']};
 assert.equal(residentPose(fishing,f,false),'fish');
 for(const phase of ['cast','wait','reel'])for(let n=0;n<12;n++)assert.ok(!residentSprite({...fishing,phase},f,false,'se',n).includes('catch'));
 assert.equal(residentPose({...fishing,tools:[]},f,false),'idle');
 assert.equal(residentPose({...fishing,state:'inspect',phase:'inspect'},f,false),'idle');
 assert.equal(residentPose({...fishing,state:'travel',phase:'travel'},f,true),'walk');
});
test('loads and construction follow confirmed inventory/materials instead of destination plans',()=>{
 const loaded={...r,carrying:{wood:1},load:2};
 assert.equal(residentPose(loaded,f,true),'carry');
 assert.equal(residentPose({...r,carrying:{stone:2}},f,true),'carry');
 assert.equal(residentPose({...r,state:'gather',carrying:{}},f,false),'idle','berry art requires a berry');
 const builder={...r,state:'construct',phase:'construct',target:{x:28,y:-1},tools:['hand_axe']};
 assert.equal(residentPose(builder,f,false),'idle');
 const site={id:1,x:28,y:-1,kind:'timber_home',stage:0,materials:{wood:1},need:{wood:4,stone:2},work:1,workNeed:30};
 const building={...f,view:{...f.view,sites:[site]}};
 assert.equal(residentPose(builder,building,false),'build');
 assert.equal(constructionStage(site),'foundation');
 assert.equal(constructionStage({...site,stage:1}),'frame');
 assert.equal(constructionStage({...site,materials:{}}),'marker','an empty site is a ground mark, not a free building');
 assert.equal(residentPose({...builder,tools:[]},building,false),'idle','the supplied tool pose requires a held work tool');
 assert.equal(residentPose(builder,building,true),'walk','confirmed motion always wins');
 assert.equal(residentPose(builder,{...building,view:{...building.view,sites:[{...site,materials:{}}]}},false),'idle');
});

test('defect 4: repair phase requires work tool and repair material, never food alone',()=>{
 const repair={...r,state:'repair',phase:'repair',tools:['hand_axe'],carrying:{wood:1}};
 assert.equal(residentPose(repair,f,false),'build');
 assert.notEqual(residentPose({...repair,tools:[]},f,false),'build');
 assert.notEqual(residentPose({...repair,carrying:{berry:1}},f,false),'build');
 assert.notEqual(residentPose({...repair,phase:'work'},f,false),'build');
});
test('new activity art needs actual work, local object, input and heat/water',()=>{
 const crop={id:3,x:28,y:-1,kind:'berry',growth:1,ripe:false,dry:false,planter:2,waterReachable:true};
 const ff={...f,view:{...f.view,crops:[crop],fireState:[{id:4,x:28,y:-1,fuel:2}]}};
 const here={...r,target:{x:28,y:-1}};
 assert.equal(residentPose({...here,state:'plant',phase:'plant',carrying:{berry:1}},ff,false),'plant');
 assert.equal(residentPose({...here,state:'plant',phase:'travel'},ff,false),'idle');
 assert.equal(residentPose({...here,state:'tend',phase:'tend'},ff,false),'tend');
 assert.equal(residentPose({...here,state:'tend',phase:'tend'},{...ff,view:{...ff.view,crops:[{...crop,waterReachable:false}]}},false),'idle');
 assert.equal(residentPose({...here,state:'harvest',phase:'harvest'},ff,false),'idle');
 assert.equal(residentPose({...here,state:'harvest',phase:'harvest'},{...ff,view:{...ff.view,crops:[{...crop,ripe:true}]}},false),'harvest');
 const cook={...here,state:'cook',phase:'cook',item:'fish',carrying:{fish:1}};
 assert.equal(residentPose(cook,ff,false),'cook');
 assert.equal(residentPose({...cook,carrying:{}},ff,false),'idle');
 assert.equal(residentPose(cook,{...ff,view:{...ff.view,fireState:[]}},false),'idle');
 assert.equal(residentPose({...cook,x:60},ff,false),'idle');
 assert.equal(residentSprite({...here,state:'tend',phase:'tend'},ff,false,'se',0),'agency.kneel');
});
test('finding f08d8a7: a held berry never turns wood work into berry picking',()=>{
 const tree:[string,string,number,number,number]=['n1','tree',9,60,8], bush:[string,string,number,number,number]=['n2','bush',9,60,3];
 const ff=(node:[string,string,number,number,number])=>({...f,view:{...f.view,nodes:[node]}}) as unknown as WorldFrame;
 const wood={...r,x:10,y:60,state:'gather',phase:'gather',item:'wood',target:{x:9,y:60},carrying:{wood:3,stick:1,berry:1},tools:[] as string[]};
 assert.equal(residentPose(wood,ff(tree),false),'work');
 for(let n=0;n<6;n++)assert.ok(!residentSprite(wood,ff(tree),false,'se',n).startsWith('gather.'));
 assert.equal(residentPose({...wood,tools:['hand_axe']},ff(tree),false),'chop');
 assert.equal(residentPose({...wood,item:'berry'},ff(bush),false),'gather','confirmed berry gathering at a live bush');
 assert.equal(residentPose({...wood,item:'berry'},ff(tree),false),'work','berry item without a bush is not berry art');
 assert.equal(residentPose({...wood,item:'berry'},ff(['n2','bush',9,60,0]),false),'hold','depleted bush: no picking');
 assert.equal(residentPose({...wood,target:{x:4,y:60}},ff(['n1','tree',4,60,8]),false),'hold','out of reach: no work gesture');
 assert.equal(residentPose({...wood,item:'stone'},ff(['n3','stone',9,60,4]),false),'work');
 assert.equal(residentSprite({...wood,phase:'store',state:'store'},ff(tree),false,'se',3),'carry.wood.0','stationary hold does not cycle');
 assert.equal(residentPose(wood,ff(tree),true),'carry','only motion plays the carry cycle');
});
test('tool-free wood and stick work never selects a prop-bearing cell, even with carried food',()=>{
 for(const kind of ['tree','deadfall','driftwood','scrub'])for(const item of ['wood','stick'])for(const carrying of [{},{berry:1},{wood:2}] as Record<string,number>[]){
  const worker={...r,x:58,y:61,state:'gather',phase:'gather',item,target:{x:57,y:60},carrying,tools:[]};
  const ff={...f,view:{...f.view,nodes:[['live',kind,57,60,8]]}} as WorldFrame;
  assert.equal(residentPose(worker,ff,false),'work');
  for(const direction of ['se','sw','ne','nw'])for(let phase=0;phase<6;phase++)assert.ok(residentSprite(worker,ff,false,direction,phase).startsWith('idle.'),'the hand gesture and inventory are rendered separately');
 }
});
