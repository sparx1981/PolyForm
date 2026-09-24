import {frame,dist,mix,box,writer,auditParts,touchDistance} from './zaun-solids.js';
import {terrainSampler} from './zaun-terrain.js';
import {bounds} from './anschluss-flaechen.js';
// Closed farm gate: applied diagonal brace from lower hinge to upper latch.
// Frame and infill occupy one depth layer; the brace bears on its front face.
// Straps lie on the timber faces, not embedded in them.
export function gatePlan(left,right,settings){const f=frame(left,right),width=f.l-1.1;if(width<.85||width>3.8)throw Error('Tor benötigt 0,85–3,8 m freie Breite zwischen seinen Pfosten.');
  const parts=[],contacts=[],slope=settings.slope,height=settings.height||1.25;
  const pos=(x,z=0)=>({x:left.x+f.t.x*x+f.n.x*z,z:left.z+f.t.z*x+f.n.z*z});
  const addBox=(id,kind,x0,x1,z0,z1,y0,y1,buried=false)=>{const p={id,kind,buried,surface:box(pos(x0,(z0+z1)/2),pos(x1,(z0+z1)/2),z1-z0,y0,y1)};parts.push(p);return p;};
  const terrain=terrainSampler(settings),lp=.47,rp=f.l-.47,base=Math.max(...terrain.surface(bounds(box(pos(lp),pos(rp),.3,0,1))).flatMap(t=>t.points.map(p=>p.y)))+.16;
  addBox('gate-post-L','wood',lp-.08,lp+.08,-.08,.08,terrain.height(pos(lp).x,pos(lp).z)-.65,base+height+.1,true);
  addBox('gate-post-R','wood',rp-.08,rp+.08,-.08,.08,terrain.height(pos(rp).x,pos(rp).z)-.65,base+height+.1,true);
  const x0=lp+.12,x1=rp-.12,z0=.005,z1=.08,b=.095;
  addBox('gate-stile-hinge','wood',x0,x0+b,z0,z1,base,base+height);
  addBox('gate-stile-latch','wood',x1-b,x1,z0,z1,base,base+height);
  const ys=[0,(height-b)/2,height-b];
  for(let i=0;i<ys.length;i++)addBox(`gate-rail-${i}`,'wood',x0+b,x1-b,z0,z1,base+ys[i],base+ys[i]+b);
  const w=writer(),s=(height-b)/(x1-x0-b),half=.052*Math.sqrt(1+s*s);
  // Clip a diagonal strip against the outer leaf rectangle; endpoints have real
  // contact patches on the two stiles and the two horizontal frame members.
  let poly=[{x:x0,y:base},{x:x1,y:base},{x:x1,y:base+height},{x:x0,y:base+height}];
  for(const sign of [-1,1]){const next=[],value=p=>half-sign*(p.y-(base+b/2+s*(p.x-x0-b/2)));for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=value(a),db=value(b);if(da>=0)next.push(a);if(da*db<0){const t=da/(da-db);next.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}}poly=next;}
  const p=(v,z)=>({...pos(v.x,z),y:v.y}),center=poly.reduce((v,p)=>({x:v.x+p.x/poly.length,y:v.y+p.y/poly.length}),{x:0,y:0});
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];w.quad(p(a,z1),p(b,z1),p(b,z1+.04),p(a,z1+.04));w.tri(p(center,z1),p(b,z1),p(a,z1));w.tri(p(center,z1+.04),p(a,z1+.04),p(b,z1+.04));}
  parts.push({id:'gate-diagonal','kind':'wood',surface:w.finish()});
  // Low-cost strap hardware on the back, leaving the front brace collision-free.
  for(const [i,y] of [base+.045,base+height-.045].entries()){
    addBox(`hinge-fixed-${i}`,'metal',lp-.05,lp+.095,-.095,-.08,y-.024,y+.024);
    addBox(`hinge-neck-${i}`,'metal',lp+.08,lp+.095,-.08,.005,y-.024,y+.024);
    addBox(`hinge-strap-${i}`,'metal',lp+.095,x0+.38,-.010,.005,y-.024,y+.024);
  }
  const latchY=base+height*.55;
  addBox('gate-latch','metal',x1-.12,rp-.095,-.010,.005,latchY,latchY+.04);
  addBox('gate-keeper-neck','metal',rp-.095,rp-.08,-.08,.005,latchY,latchY+.04);
  addBox('gate-keeper','metal',rp-.095,rp+.03,-.095,-.08,latchY,latchY+.04);
  // The latch's keeper sits behind the post; the latch stops at its near side.
  // No decorative fastener shafts intersect the timber.
  const joints=[];for(const id of ['gate-rail-0','gate-rail-1','gate-rail-2','gate-diagonal'])for(const stile of ['gate-stile-hinge','gate-stile-latch'])joints.push([id,stile]);
  for(const i of [0,1])joints.push([`hinge-fixed-${i}`,'gate-post-L'],[`hinge-neck-${i}`,`hinge-fixed-${i}`],[`hinge-strap-${i}`,`hinge-neck-${i}`],['gate-stile-hinge',`hinge-strap-${i}`]);
  joints.push(['gate-latch','gate-stile-latch'],['gate-latch','gate-keeper-neck'],['gate-keeper-neck','gate-keeper'],['gate-keeper','gate-post-R']);
  for(const [member,support] of joints)contacts.push({member,support,...touchDistance(parts.find(p=>p.id===member).surface,parts.find(p=>p.id===support).surface)});
  return {parts,contacts,points:[pos(lp),pos(rp)],diagnostics:auditParts(parts,contacts,settings),construction:{gateClearWidth:width,gate:'closed'}};
}
