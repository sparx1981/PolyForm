import {prepareConstructionCenterline} from './construction-centerline.js';
import {createArcTable,sampleArc,resamplePolyline,closestSegmentApproach,adaptPathToProfile} from './path-layout.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
// Sparse authored anchors stay authoritative. Densification and smoothing are
// derived, identical for paint, editing and restore; never saved as replacement intent.
function soften(anchors) {
  const closed=distance(anchors[0],anchors.at(-1))<1e-6;
  let p=[];
  // Bound corner rounding by construction scale, not by arbitrary anchor spacing.
  for(let i=1;i<anchors.length;i++){const a=anchors[i-1],b=anchors[i],n=Math.max(1,Math.ceil(distance(a,b)/.9));for(let j=0;j<n;j++)p.push({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n});}
  if(!closed)p.push({...anchors.at(-1)});
  for(let pass=0;pass<3;pass++) {
    const q=closed?[]:[p[0]];
    for(let i=0;i<(closed?p.length:p.length-1);i++) {
      const a=p[i],b=p[(i+1)%p.length];
      q.push({x:a.x*.75+b.x*.25,z:a.z*.75+b.z*.25},{x:a.x*.25+b.x*.75,z:a.z*.25+b.z*.75});
    }
    if(!closed)q.push(p.at(-1));p=q;
  }
  if(closed)p.push({...p[0]});
  return resamplePolyline(p,.2);
}
export function prepareFencePath(raw,{authored=false,layout='worm',bay=2.25,spread=.625}={}) {
  if(!Array.isArray(raw)||raw.length<2||raw.length>3000||raw.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z)||Math.abs(p.x)>100||Math.abs(p.z)>100))throw Error('Ungültige Pfadpunkte.');
  if(authored&&raw.some((p,i)=>i>0&&distance(p,raw[i-1])<.12))throw Error('Bearbeitungspunkte liegen zu dicht beieinander.');
  const prep=prepareConstructionCenterline(raw,{widthM:1.3,allowClosure:true,densify:soften});
  // Explicitly inserted edit handles must survive RDP (even on a straight line).
  // Raw drawing is simplified once; restore and subsequent edits retain anchors.
  if(authored){prep.authoredPoints=raw.map(p=>({...p}));if(prep.closed)prep.authoredPoints[prep.authoredPoints.length-1]={...raw[0]};}
  if(!prep.closed){prep.authoredPoints[0]={...raw[0]};prep.authoredPoints[prep.authoredPoints.length-1]={...raw.at(-1)};}
  prep.compilerReadyPoints=adaptPathToProfile(soften(prep.authoredPoints),{width:1.3,strength:.48}).points;
  const table=createArcTable(prep.compilerReadyPoints),length=table.totalLength;
  if(length<2.3)throw Error('Mindestens 2,3 m Verlauf für ein Zaunfeld zeichnen.');
  if(length>65)throw Error('Dieser Prüfstand unterstützt bis 65 m pro Zaun.');
  let count=Math.max(1,Math.round(length/bay));
  if(prep.closed)count=Math.max(6,Math.round(count/2)*2);
  const step=length/count;
  function sample(s){return sampleArc(table,prep.closed?(s%length+length)%length:Math.max(0,Math.min(length,s)));}
  const nodes=[];
  for(let i=0;i<(prep.closed?count:count+1);i++) {
    const s=i*step,c=sample(s),a=sample(s-.8),b=sample(s+.8),len=distance(a,b);
    if(len<.1)throw Error('Umkehr im Verlauf: die Kurve weiter ziehen.');
    // Symmetric zigzag around the intent, not an unrelated offset whole fence.
    const side=layout==='plain'?0:(i%2?1:-1)*spread;
    nodes.push({x:c.x-(b.z-a.z)/len*side,z:c.z+(b.x-a.x)/len*side});
  }
  const bays=prep.closed?nodes.length:nodes.length-1;
  for(let i=0;i<bays;i++) {
    const a=nodes[i],b=nodes[(i+1)%nodes.length],len=distance(a,b);
    if(len<1.4||len>3.8)throw Error('Feld wird zu kurz oder zu lang: Verlauf großzügiger führen.');
    if(layout!=='plain'&&(i>0||prep.closed)) {
      const p=nodes[(i-1+nodes.length)%nodes.length];
      const cosine=((p.x-a.x)*(b.x-a.x)+(p.z-a.z)*(b.z-a.z))/(distance(p,a)*len);
      const angle=Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI;
      if(angle<65||angle>165)throw Error('Zickzack-Ecke nicht baubar: Kurve weiter ziehen.');
    }
    for(let j=i+2;j<bays;j++) {
      if(prep.closed&&i===0&&j===bays-1)continue;
      const c=nodes[j],d=nodes[(j+1)%nodes.length];
      if(closestSegmentApproach(a,b,c,d).distance<.8)throw Error('Zaun kommt sich selbst zu nahe. Schleife öffnen oder vergrößern.');
    }
  }
  return {...prep,nodes,length,bays};
}
