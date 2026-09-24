import {prepareFencePath} from './zaun-pfad.js';
import {createArcTable,trimPolyline,sampleArc} from './path-layout.js';
import {planeAnschluss} from './anschluss-plan.js';
import {postRailPlan} from './zaun-pfosten.js';
import {skigardPlan} from './zaun-skigard.js';
import {gatePlan} from './zaun-tor.js';
import {notchedStile,mix,dist,slopeSurface,auditParts,translateY} from './zaun-solids.js';
import {terrainSampler} from './zaun-terrain.js';

function build(p,s,type){if(type==='pfosten')return postRailPlan(p,s);if(type==='skigard')return skigardPlan(p,s);return planeAnschluss({...s,nodes:p.nodes,closed:p.closed,rider:type==='stake'});}
function prefix(plan,tag){for(const p of plan.parts)p.id=tag+p.id;for(const c of plan.contacts){c.member=tag+c.member;c.support=tag+c.support;}return plan;}
function combine(plans,settings){const parts=plans.flatMap(p=>p.parts),contacts=plans.flatMap(p=>p.contacts),points=plans.flatMap(p=>p.points);return {parts,contacts,points,diagnostics:auditParts(parts,contacts,settings)};}
export function compileFence(prepared,settings){const type=settings.type||(settings.rider?'stake':'wurm');
  if(!['wurm','stake','pfosten','skigard','hybrid'].includes(type))throw Error('Unbekannte Bauart.');
  const table=createArcTable(prepared.compilerReadyPoints),total=table.totalLength;
  if(type==='hybrid'&&settings.hybridReverse)return compileFence(prepareFencePath(prepared.compilerReadyPoints.slice().reverse(),{layout:'plain'}),{...settings,hybridReverse:false,transition:100-(settings.transition??50)});
  if(!settings.gate&&type!=='hybrid')return build(prepared,settings,type);
  if(prepared.closed)throw Error('Tor und Hybrid-Übergang benötigen einen offenen Verlauf. Einen Punkt am Ende öffnen.');
  let transition=Math.max(.2,Math.min(.8,(settings.transition??50)/100));
  if(type==='hybrid'&&settings.hybridAuto&&!settings.gate){let previous=null,first=null;const changes=[],heightAt=terrainSampler(settings).height;for(let s=.5;s<total-.5;s+=.25){const a=sampleArc(table,s-.4),b=sampleArc(table,s+.4),steep=Math.abs((heightAt(b.x,b.z)-heightAt(a.x,a.z))/Math.max(.01,dist(a,b)))>.18;if(first===null)first=steep;if(previous!==null&&previous!==steep)changes.push(s);previous=steep;}if(!changes.length)return build(prepared,settings,previous?'skigard':'wurm');if(changes.length>1)throw Error('Mehrere Gefällewechsel: manuellen Hybrid-Übergang wählen.');transition=changes[0]/total;if(first)return compileFence(prepareFencePath(prepared.compilerReadyPoints.slice().reverse(),{layout:'plain'}),{...settings,hybridAuto:false,transition:(1-transition)*100});}
  const gap=settings.gate?(settings.gateWidth||1.8)+1.1:.90,center=total*transition,start=center-gap/2,end=center+gap/2;
  if(start<2.3||total-end<2.3)throw Error('Beidseits des Übergangs werden mindestens 2,3 m Zaun benötigt. Verlauf verlängern oder Übergang verschieben.');
  const left=prepareFencePath(trimPolyline(table.points,0,total-start)),right=prepareFencePath(trimPolyline(table.points,end,0));
  const A=prefix(build(left,settings,type==='hybrid'?'wurm':type),'L-'),B=prefix(build(right,settings,type==='hybrid'?'skigard':type),'R-');
  if(!A.diagnostics.valid||!B.diagnostics.valid){const d=!A.diagnostics.valid?A.diagnostics:B.diagnostics;throw Error('Teilabschnitt nicht baubar: '+[...d.groundViolations.map(id=>'Bodenschnitt '+id),...d.collisions.map(c=>c.a+' / '+c.b),...d.constructionErrors].join(', '));}
  const a=A.points.at(-1),b=B.points[0],length=dist(a,b);
  if(settings.gate){const G=prefix(gatePlan(a,b,settings),'G-'),plan=combine([A,G,B],settings);plan.construction={...G.construction,type};return plan;}
  if(length<.73||length>1.5)throw Error('Hybrid-Übergang zu eng oder versetzt. Einen geraderen Übergangsbereich wählen.');
  // The two historical systems terminate independently. A separately founded
  // broad transition stile closes their offset; small air joints allow movement.
  // This is explicitly a modern hybrid detail, not an invented historical joint.
  const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length,woodEnds=A.parts.filter(p=>p.kind!=='stone').flatMap(p=>p.surface.flatMap(t=>t.points)).filter(p=>Math.hypot(p.x-a.x,p.z-a.z)<.65);
  const startOffset=Math.max(.3,...woodEnds.map(p=>(p.x-a.x)*tx+(p.z-a.z)*tz))+.025;
  const rightEnds=B.parts.flatMap(p=>p.surface.flatMap(t=>t.points)).filter(p=>Math.hypot(p.x-b.x,p.z-b.z)<.65);
  const endOffset=Math.min(length-.10,...rightEnds.map(p=>(p.x-a.x)*tx+(p.z-a.z)*tz))-.035;
  const p=mix(a,b,startOffset/length),q=mix(a,b,endOffset/length),height=Math.max(settings.height||1.25,settings.layers*.18)+.1;
  if(dist(p,q)<.22)throw Error('Hybrid: zu wenig Raum für den gegründeten Übergangspfosten.');
  const rawStile=notchedStile(p,q,.16,Math.max(.01,.54-startOffset),.14,height),ground=terrainSampler(settings);
  const stile={id:'hybrid-stile',kind:'wood',buried:true,surface:settings.terrain?translateY(rawStile,Math.max(ground.height(p.x,p.z),ground.height(q.x,q.z))):slopeSurface(rawStile,settings.slope)};
  const plan=combine([A,{parts:[stile],contacts:[],points:[]},B],settings);plan.construction={type,transitionDetail:'separately-founded-notched-stile',movementJointsM:[.04,.10]};return plan;
}
