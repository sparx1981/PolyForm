import {createArcTable,sampleArc} from './path-layout.js';
import {querschnitt} from './wurmzaun-compiler.js';
import {minimumGap} from './anschluss-flaechen.js';
import {frame,mix,loft,pole,writer,translateY,slopeSurface,auditParts} from './zaun-solids.js';
import {terrainSampler,terrainContact} from './zaun-terrain.js';

function hull(points){const sorted=points.slice().sort((a,b)=>a.x-b.x||a.z-b.z),cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x),half=p=>{const out=[];for(const v of p){while(out.length>1&&cross(out.at(-2),out.at(-1),v)<=0)out.pop();out.push(v);}return out;};return [...half(sorted).slice(0,-1),...half(sorted.reverse()).slice(0,-1)];}
function offset(p,d){return p.map((c,i)=>{const a=p[(i-1+p.length)%p.length],b=p[(i+1)%p.length],A=frame(a,c),B=frame(c,b),nx=-A.n.x-B.n.x,nz=-A.n.z-B.n.z,den=1+A.n.x*B.n.x+A.n.z*B.n.z;return{x:c.x+nx*d/den,z:c.z+nz*d/den};});}
// Solid annular binding, fitted to the convex envelope of the two actual poles.
// It has inner/outer walls and top/bottom faces; no disconnected ribbon segments.
function binding(contour,plane,width=.014){const inside=offset(contour,.00002),outside=offset(contour,width+.00002),w=writer(),p=(v,dy)=>({...v,y:plane(v)+dy});
  for(let i=0;i<inside.length;i++){const j=(i+1)%inside.length,a=inside[i],b=inside[j],c=outside[j],d=outside[i];w.quad(p(a,0),p(b,0),p(c,0),p(d,0));w.quad(p(d,-width),p(c,-width),p(b,-width),p(a,-width));w.quad(p(a,-width),p(b,-width),p(b,0),p(a,0));w.quad(p(d,0),p(c,0),p(c,-width),p(d,-width));}return w.finish();}

function build(prepared,settings,span){const table=createArcTable(prepared.compilerReadyPoints),closed=prepared.closed,count=Math.max(3,Math.round(table.totalLength/(settings.spacing||.85))),step=table.totalLength/count,nodes=Array.from({length:closed?count:count+1},(_,i)=>sampleArc(table,i*step)),parts=[],contacts=[],rails=[],height=settings.height||1.25,dir=settings.direction===-1?-1:1;
  const terrain=terrainSampler(settings),sampled=!!settings.terrain;
  if(dir<0)nodes.reverse();
  const station=i=>{const index=closed?(i%nodes.length+nodes.length)%nodes.length:Math.max(0,Math.min(nodes.length-1,i)),lo=Math.floor(index),hi=closed?(lo+1)%nodes.length:Math.min(nodes.length-1,lo+1);return mix(nodes[lo],nodes[hi],index-lo);};
  const start=closed?0:1-span,end=count;
  const density=settings.density||2;
  for(let index=start*density;index<end*density;index++){const i=index/density,first=closed?i:Math.max(0,i),last=closed?i+span:Math.min(count,i+span),a=station(first),b=station(last),f=frame(a,b);
    if(f.l<.18)throw Error('Skigard-Verlauf zu eng.');
    const rise=height-.13,d=.075+Math.sin(settings.seed*3+i*7)*.007,profile=querschnitt(settings.form,.075,d,settings.seed+i*31),low=-Math.min(...profile.map(p=>p[1])),y0=low+(first-i)/span*rise,y1=low+(last-i)/span*rise;
    // Exact flat underside at the low endpoint supplies the ground contact.
    const middle=profile.map(([u,v],k)=>[u*(1+.025*Math.sin(k*7+i*11)),v*(1+.025*Math.cos(k*9+i*5))]);
    const A=y0+(sampled?terrain.height(a.x,a.z):0),B=y1+(sampled?terrain.height(b.x,b.z):0);
    const rail={id:`ski-${i}`,kind:'wood',first,last,origin:i,a,b,f,y0:A,y1:B,surface:loft(a,b,[{s:0,profile,y:A},{s:f.l*.5,profile:middle,y:(A+B)/2},{s:f.l,profile,y:B}])};
    if(sampled&&first===i){const contact=terrainContact(rail.surface,terrain);rail.surface=translateY(rail.surface,-contact.gap);rail.y0-=contact.gap;rail.y1-=contact.gap;}
    parts.push(rail);rails.push(rail);
    if(first===i){if(sampled)contacts.push({member:rail.id,support:'ground',...terrainContact(rail.surface,terrain)});else{let hit=null;for(const t of rail.surface)for(const v of t.points)if(!hit||v.y<hit.y)hit=v;contacts.push({member:rail.id,support:'ground',x:hit.x,z:hit.z,lowerY:0,gap:hit.y});}}
  }
  for(let j=0;j<nodes.length;j++){const c=nodes[j],f=frame(station(j-1),station(j+1)),crossings=[];
    for(const rail of rails){let index=j;if(closed&&index<rail.first)index+=count;if(index<rail.first||index>rail.last)continue;const den=(rail.b.x-rail.a.x)*f.t.x+(rail.b.z-rail.a.z)*f.t.z,s=((c.x-rail.a.x)*f.t.x+(c.z-rail.a.z)*f.t.z)/den;if(!Number.isFinite(s)||s<-.01||s>1.01)throw Error('Skigard: Pfahlpaar verfehlt ein Holz.');const p=mix(rail.a,rail.b,s),side=(p.x-c.x)*f.n.x+(p.z-c.z)*f.n.z;crossings.push({rail,index,side});}
    if(!crossings.length)continue;
    const radius=.029,lo=Math.min(...crossings.map(v=>v.side))-.039-radius-.002,hi=Math.max(...crossings.map(v=>v.side))+.039+radius+.002;
    if(hi-lo>.29)throw Error('Skigard: Krümmung benötigt zu breite Pfahlpaare.');
    const poleDatum=sampled?Math.max(terrain.height(c.x,c.z),...crossings.map(({rail})=>{const u=((c.x-rail.a.x)*rail.f.t.x+(c.z-rail.a.z)*rail.f.t.z)/rail.f.l;return rail.y0+u*(rail.y1-rail.y0)-height+.12;})):0;
    const poles=[lo,hi].map((s,k)=>{const p={x:c.x+f.n.x*s,z:c.z+f.n.z*s},top=poleDatum+height+.25+(.5+.5*Math.sin(j*17+k*8+settings.seed))*.22;const part={id:`staur-${j}-${k}`,kind:'wood',buried:true,surface:pole(p,radius,(sampled?terrain.height(p.x,p.z):0)-.38,top)};parts.push(part);return p;});
    const contour=hull(poles.flatMap(p=>Array.from({length:8},(_,i)=>({x:p.x+Math.cos(i*Math.PI/4)*radius,z:p.z+Math.sin(i*Math.PI/4)*radius}))));
    for(const {rail,index} of crossings){if(index===rail.origin)continue;const gradient=(rail.y1-rail.y0)/rail.f.l,plane=p=>((p.x-rail.a.x)*rail.f.t.x+(p.z-rail.a.z)*rail.f.t.z)*gradient;
      const thickness=settings.binding==='draht'?.004:settings.binding==='wurzel'?.010:.014;
      let surface=binding(contour,plane,thickness),gap=minimumGap(surface,rail.surface).gap;
      if(!Number.isFinite(gap))throw Error('Skigard-Bindung erreicht das Holz nicht.');surface=translateY(surface,gap-.00005);
      const part={id:`binding-${j}-${rail.id}`,kind:'binding',surface};parts.push(part);contacts.push({member:rail.id,support:part.id,...minimumGap(surface,rail.surface)});
      if(settings.binding!=='draht')parts.push({id:part.id+'-turn',kind:'binding',surface:translateY(surface,-(thickness+.004))});
    }
  }
  if(!sampled){for(const p of parts)p.surface=slopeSurface(p.surface,settings.slope);for(const c of contacts)c.lowerY+=settings.slope*c.x;}
  return {parts,contacts,points:dir<0?nodes.slice().reverse():nodes,diagnostics:auditParts(parts,contacts,settings),construction:{span,spacing:step}};
}
export function skigardPlan(prepared,settings){let error;for(const span of [3,2]){try{const p=build(prepared,settings,span);if(p.diagnostics.valid)return p;error=Error(`Skigard: ${p.diagnostics.collisions.length} Kollisionen, ${p.diagnostics.badMeshes.length} Netzfehler, ${p.diagnostics.groundViolations.length} Bodenschnitte`);}catch(e){error=e;}}throw error;}
