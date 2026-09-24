import {bauteilOberflaeche} from './wurmzaun-compiler.js';
import {settle,minimumGap,topAt,meshMetrics,surfaceCrossings} from './anschluss-flaechen.js';
import {terrainSampler,terrainContact} from './zaun-terrain.js';

// M1: a construction specimen, not yet a replacement for all five generators.
// Its stones, wood surfaces and named contact graph are the rendered plan.
export function planeAnschluss({seed=7,layers=6,slope=0,terrain=null,shape='gerade',form='spaltkeil',rider=false,nodes=null,closed=false}={}) {
  if(!Number.isInteger(layers)||layers<3||layers>8||!Number.isFinite(slope)||Math.abs(slope)>.3)throw Error('Lagen oder Gefälle außerhalb des Prüfbereichs.');
  const points=nodes || (shape==='bogen'
    ? [{x:-4.5,z:0},{x:-2.2,z:1.0},{x:0,z:-.3},{x:2.1,z:1.4},{x:4.2,z:.5}]
    : [{x:-4.5,z:0},{x:-2.25,z:1.25},{x:0,z:0},{x:2.25,z:1.25},{x:4.5,z:0}]);
  if(points.length<2||points.length>32||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z)))throw Error('Ungültige Konstruktionsknoten.');
  if(closed&&points.length%2)throw Error('Ein geschlossener Wechselverband benötigt eine gerade Feldzahl.');
  const bayCount=closed?points.length:points.length-1;
  const ground=terrainSampler({terrain,slope}),heightAt=ground.height;
  const parts=[], contacts=[], tops=[];
  for(let i=0;i<points.length;i++) {
    const c=points[i];
    const local=terrain?ground.surface({min:{x:c.x-.43,z:c.z-.43},max:{x:c.x+.43,z:c.z+.43}}).flatMap(t=>t.points.map(p=>p.y)):[heightAt(c.x,c.z)];
    const base=terrain?Math.min(...local):heightAt(c.x,c.z),top=terrain?Math.max(...local)+.11:base+.085;
    const stone={id:`stone-${i}`,x:c.x,z:c.z,grundY:base,hoeheM:top-base,breiteM:.66,tiefeM:.55,drehung:.4};
    const part={...stone,kind:'stone',surface:bauteilOberflaeche(stone,'stein')};
    parts.push(part);tops.push(part);
  }
  function place(id,a,b,level,supports,short=false) {
    const rand=Math.sin(seed*39+level*19+a.x*11)*.5+.5;
    const len=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/len,dz=(b.z-a.z)/len,over=short?0:.28;
    const member={id,kind:'wood',level,form,seed:seed+level*29+parts.length*13,
      von:{x:a.x-dx*over,y:0,z:a.z-dz*over},bis:{x:b.x+dx*over,y:0,z:b.z+dz*over},
      breiteM:.135*(.85+rand*.3),dickeM:.085*(.87+rand*.2),bogenM:(rand-.5)*.024,drallGrad:(rand-.5)*5};
    const foundations=terrain?parts.filter(p=>p.kind==='stone'&&[a,b].some(c=>Math.hypot(c.x-p.x,c.z-p.z)<.5)):[];
    const localFoundations=supports.map((s,i)=>foundations.filter(p=>supports.length===1||Math.hypot(p.x-[a,b][i].x,p.z-[a,b][i].z)<.5));
    const solved=settle(bauteilOberflaeche(member),a,b,supports.map((s,i)=>({...s,surface:[...s.surface,...localFoundations[i].flatMap(p=>p.surface)]})));
    if(terrain)solved.contacts=solved.contacts.map((c,i)=>[supports[i],...localFoundations[i]].map(p=>({support:p.id,...minimumGap(p.surface,solved.surface)})).sort((a,b)=>a.gap-b.gap)[0]);
    const part={...member,...solved};
    parts.push(part);contacts.push(...solved.contacts.map(c=>({...c,member:id})));
    return part;
  }
  // Each terminal alternates full rails and real short return timbers.
  // The predecessor filled the missing slots numerically with invisible wood.
  for(let level=0;level<layers*2;level++) {
    for(let bay=0;bay<bayCount;bay++) {
      if(bay%2!==level%2) continue;
      const next=(bay+1)%points.length,a=points[bay],b=points[next];
      const p=place(`rail-${bay}-${level}`,a,b,level,[tops[bay],tops[next]]);
      tops[bay]=tops[next]=p;
    }
    for(const i of (closed?[]:[0,points.length-1])) {
      const bay=i===0?0:points.length-2;
      if(bay%2===level%2) continue;
      const c=points[i],neighbor=points[i===0?1:i-1];
      const dx=neighbor.x-c.x,dz=neighbor.z-c.z,len=Math.hypot(dx,dz);
      const a={x:c.x-dz/len*.36,z:c.z+dx/len*.36};
      const b={x:c.x+dz/len*.36,z:c.z-dx/len*.36};
      tops[i]=place(`return-${i}-${level}`,a,b,level,[tops[i]],true);
    }
  }
  const constructionErrors=[];
  if(rider) {
    const forks=[];
    for(let i=0;i<points.length;i++) {
      const c=points[i],left=points[closed?(i-1+points.length)%points.length:Math.max(0,i-1)],right=points[closed?(i+1)%points.length:Math.min(points.length-1,i+1)];
      const dx=right.x-left.x,dz=right.z-left.z,len=Math.hypot(dx,dz),t={x:dx/len,z:dz/len},q={x:-t.z,z:t.x};
      const endOffset=closed?0:i===0?-.20:i===points.length-1?.20:0;
      const forkCenter={x:c.x+t.x*endOffset,z:c.z+t.z*endOffset};
      // Height at THIS corner, not the highest vertex of a rail on the hill.
      const top=topAt(tops[i].surface,c);
      let chosen=null;
      // A finite set of constructible stances. Failure stays a failure; the last
      // colliding candidate is never emitted as the predecessor did.
      for(const rise of [.16,.24,.32]) {
        if(chosen)break;
        for(const spread of [.85,1.0,1.2,1.4]) {
          const crossing=top+rise,pair=[];
          for(const sign of [-1,1]) {
            const foot={x:forkCenter.x+q.x*spread*sign+t.x*.05*sign,z:forkCenter.z+q.z*spread*sign+t.z*.05*sign};
            const y=heightAt(foot.x,foot.z)-.22,baseHeight=crossing-y;
            const extension=.34;
            const member={id:`stake-${i}-${sign}`,kind:'stake',form:'spaltkeil',seed:seed+i*71,
              von:{...foot,y},bis:{x:forkCenter.x+t.x*.05*sign-q.x*extension*sign,y:crossing+extension*baseHeight/spread,z:forkCenter.z+t.z*.05*sign-q.z*extension*sign},
              breiteM:.095,dickeM:.07,bogenM:0,drallGrad:0,verjuengung:.94};
            pair.push({...member,surface:bauteilOberflaeche(member)});
          }
          if(pair.some(p=>parts.some(other=>surfaceCrossings(p.surface,other.surface)))||surfaceCrossings(pair[0].surface,pair[1].surface))continue;
          chosen=pair;break;
        }
      }
      if(!chosen) {constructionErrors.push(`Keine freie Stakenstellung an Ecke ${i}`);break;}
      parts.push(...chosen);
      forks.push({id:`fork-${i}`,surface:chosen.flatMap(p=>p.surface),members:chosen.map(p=>p.id)});
    }
    if(forks.length===points.length) {
      // Alternating rider courses, with the heavier rail seated on actual fork
      // faces or on the preceding rider. Never infer support from distance.
      for(const phase of [0,1]) for(let bay=phase;bay<bayCount;bay+=2) {
        const next=(bay+1)%points.length,a=points[bay],b=points[next],len=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/len,dz=(b.z-a.z)/len;
        const member={id:`rider-${bay}`,kind:'rider',form,seed:seed+bay*31,
          von:{x:a.x-dx*.26,y:0,z:a.z-dz*.26},bis:{x:b.x+dx*.26,y:0,z:b.z+dz*.26},
          breiteM:.17,dickeM:.11,bogenM:0,drallGrad:0};
        const supports=[forks[bay],forks[next]];
        const solved=settle(bauteilOberflaeche(member),a,b,supports);
        const p={...member,...solved};parts.push(p);
        contacts.push(...solved.contacts.map(c=>({...c,member:p.id})));
        // The second rider must also clear the two arms of the fork. Replacing
        // the fork by only the first rider loses these constraints on curves.
        for(const end of [bay,next])forks[end]={id:`fork-and-rider-${end}`,surface:[...forks[end].surface,...p.surface]};
      }
    }
  }
  const collisions=[];
  const wood=parts.filter(p=>p.kind==='wood');
  // Vertical ordering is prescribed by the alternating courses. Test ALL pairs,
  // including non-neighbours; no role exceptions, 800-piece bypass or 2-cm slack.
  for(let i=0;i<wood.length;i++) for(let j=i+1;j<wood.length;j++) {
    const a=wood[i],b=wood[j],g=minimumGap(a.surface,b.surface);
    if(g.gap < -0.000001) collisions.push({a:a.id,b:b.id,penetration:-g.gap});
  }
  const otherWood=parts.filter(p=>p.kind==='stake'||p.kind==='rider');
  for(const p of otherWood) for(const q of parts) {
    if(p===q||q.kind==='stone'||(otherWood.includes(q)&&parts.indexOf(q)<parts.indexOf(p)))continue;
    if(surfaceCrossings(p.surface,q.surface))collisions.push({a:p.id,b:q.id,type:'surface-crossing'});
  }
  const invalidContacts=contacts.filter(c=>!Number.isFinite(c.gap)||c.gap<-.000001||c.gap>.0002);
  const groundViolations=[];let minimumGroundGapM=Infinity;
  for(const p of parts.filter(p=>p.kind!=='stake'&&p.kind!=='stone')){const gap=terrainContact(p.surface,ground).gap;minimumGroundGapM=Math.min(minimumGroundGapM,gap);if(gap<-.000001)groundViolations.push(p.id);}
  const badMeshes=[...wood,...otherWood].filter(p=>{const m=meshMetrics(p.surface);return m.volume<=0||m.degenerate>0||m.badEdges>0;});
  return {parts,contacts,points,heightAt,diagnostics:{valid:!collisions.length&&!invalidContacts.length&&!badMeshes.length&&!constructionErrors.length&&!groundViolations.length,
    groundViolations,minimumGroundGapM,
    constructionErrors,collisions,invalidContacts,badMeshes:badMeshes.map(p=>p.id),triangles:parts.reduce((n,p)=>n+p.surface.length,0),
    contactCount:contacts.length,maxGap:Math.max(...contacts.map(c=>c.gap)),minGap:Math.min(...contacts.map(c=>c.gap))}};
}
