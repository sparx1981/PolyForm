import {createArcTable,sampleArc} from './path-layout.js';
import {querschnitt} from './wurmzaun-compiler.js';
import {minimumGap} from './anschluss-flaechen.js';
import {frame,dist,mix,loft,mortisePost,slopeSurface,auditParts,box} from './zaun-solids.js';
import {terrainSampler} from './zaun-terrain.js';
import {bounds} from './anschluss-flaechen.js';

export function postRailPlan(prepared,settings){const table=createArcTable(prepared.compilerReadyPoints),count=Math.max(1,Math.round(table.totalLength/(settings.bay||2.5))),closed=prepared.closed,points=Array.from({length:closed?count:count+1},(_,i)=>sampleArc(table,i*table.totalLength/count));
  const rows=settings.rows||3,parts=[],contacts=[],posts=[],height=settings.height||1.25;
  const terrain=terrainSampler(settings),terraced=!!settings.terrain;
  const levels=Array.from({length:rows},(_,i)=>.22+i*(terraced?Math.max(.14,Math.round((height-.4)/(rows-1)/.14)*.14):(height-.4)/(rows-1)));
  const datums=Array.from({length:count},(_,i)=>{if(!terraced)return 0;const a=points[i],b=points[(i+1)%points.length],triangles=terrain.surface(bounds(box(a,b,.3,0,1)));return Math.ceil(Math.max(...triangles.flatMap(t=>t.points.map(p=>p.y)))/.14)*.14;});
  for(let i=0;i<points.length;i++){const a=points[closed?(i-1+points.length)%points.length:Math.max(0,i-1)],c=points[i],b=points[closed?(i+1)%points.length:Math.min(points.length-1,i+1)],f=frame(a,b),halfTurn=(i===0||i===points.length-1)&&!closed?0:Math.acos(Math.max(-1,Math.min(1,((c.x-a.x)*(b.x-c.x)+(c.z-a.z)*(b.z-c.z))/(dist(a,c)*dist(c,b)))))/2;
    if(halfTurn>Math.PI/5)throw Error('Pfosten-Riegel: Richtungswechsel auf mehrere Felder verteilen.');
    const adjacent=[datums[(i-1+count)%count],datums[i%count]];if(!closed&&i===0)adjacent[0]=adjacent[1];if(!closed&&i===count)adjacent[1]=adjacent[0];
    const slotWidth=.047+.22*Math.tan(halfTurn),depth=Math.max(.15,slotWidth+.065),slots=[...new Set(adjacent.flatMap(d=>levels.map(y=>Math.round((y+d)*1e8)/1e8)))].sort((a,b)=>a-b).map(y=>({y,h:.084,w:slotWidth}));
    const bottom=terraced?terrain.height(c.x,c.z)-.6:-.6,top=terraced?Math.max(...slots.map(s=>s.y))+.23:height+.07;
    if(top-bottom>3.5)throw Error('Geländesprung benötigt kürzere Pfostenfelder.');
    const post={id:`post-${i}`,kind:'wood',buried:true,slots,tangent:f.t,surface:mortisePost(c,f.t,.20,depth,bottom,top,slots)};parts.push(post);posts.push(post);
  }
  for(let i=0;i<count;i++){const j=(i+1)%points.length,a=points[i],b=points[j],f=frame(a,b);if(f.l<1.2)throw Error('Pfostenfeld zu kurz.');
    for(let row=0;row<rows;row++){const y=levels[row]+datums[i],tenon=[[-.022,0],[.022,0],[.022,.07],[-.022,.07]],body=querschnitt(settings.form,.11,.14,settings.seed+i*11+row).map(([u,v])=>[u,v+.04]);
      // Four-sided body retains its selected outer dimensions; tenons share
      // profile vertex count through perimeter resampling to avoid twisted quads.
      const resample=(p,n)=>Array.from({length:n},(_,k)=>{const dx=Math.cos(k*2*Math.PI/n),dy=Math.sin(k*2*Math.PI/n);let r=Infinity;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],ex=b[0]-a[0],ey=b[1]-a[1],den=dx*ey-dy*ex;if(Math.abs(den)<1e-10)continue;const s=(a[0]*ey-(a[1]-.035)*ex)/den,t=(a[0]*dy-(a[1]-.035)*dx)/den;if(s>0&&t>=-1e-9&&t<=1+1e-9)r=Math.min(r,s);}if(!Number.isFinite(r))throw Error('Zapfenprofil nicht sternförmig');return [dx*r,.035+dy*r];});
      const n=24,T=resample(tenon,n),B=resample(body,n),start=mix(a,b,.012/f.l),end=mix(a,b,1-.012/f.l),len=dist(start,end);
      const shoulder=k=>(.1+.06*Math.abs(f.n.x*posts[k].tangent.x+f.n.z*posts[k].tangent.z))/Math.abs(f.t.x*posts[k].tangent.x+f.t.z*posts[k].tangent.z)-.012+.00005;
      const leftShoulder=shoulder(i),rightShoulder=shoulder(j);
      const surface=loft(start,end,[{s:0,profile:T},{s:leftShoulder,profile:T},{s:leftShoulder,profile:B},{s:len-rightShoulder,profile:B},{s:len-rightShoulder,profile:T},{s:len,profile:T}],y);
      const rail={id:`mortise-rail-${i}-${row}`,kind:'wood',surface};parts.push(rail);
      for(const k of [i,j]){const floor=posts[k].surface.filter(t=>t.points.every(p=>Math.abs(p.y-y)<1e-7));contacts.push({member:rail.id,support:posts[k].id,...minimumGap(floor,surface)});}
    }
  }
  if(!terraced){for(const p of parts)p.surface=slopeSurface(p.surface,settings.slope);for(const c of contacts)c.lowerY+=settings.slope*c.x;}
  return {parts,contacts,points,diagnostics:auditParts(parts,contacts,settings),construction:{terraced,datums}};
}
