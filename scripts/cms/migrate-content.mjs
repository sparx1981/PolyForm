// One-time mechanical migration. Original values remain the fallback; never run on an already migrated tree.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
const dir = 'src/components/marketing/';
const catalog = {}, pages = {};
const key = value => { let h = 2166136261; for (let i=0;i<value.length;i++) h=Math.imul(h^value.charCodeAt(i),16777619); return 'c'+(h>>>0).toString(16); };
function register(value, group) {
  const id=key(value); if(catalog[id] && catalog[id].value!==value) throw Error('Hash collision');
  catalog[id] ??= {value, groups:[]}; if(!catalog[id].groups.includes(group)) catalog[id].groups.push(group);
}
const decode = text => text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':'\u00a0'}[x] ?? String.fromCodePoint(x[2]==='x' ? parseInt(x.slice(3,-1),16) : parseInt(x.slice(2,-1),10))));
function clean(text) {
  const lines=text.split(/\r\n|\n|\r/); let last=0; lines.forEach((l,i)=>{if(/[^ \t]/.test(l))last=i;});
  return decode(lines.map((l,i)=> {let s=l.replace(/\t/g,' ');if(i!==0)s=s.replace(/^ +/,'');if(i!==lines.length-1)s=s.replace(/ +$/,'');return s+(s && i!==last?' ':'');}).join(''));
}
const displayProps = new Set(['name','title','text','body','label','description','signature','returns','sig','t','kicker','kind','prompt','href','shot','eyebrow','cta','heading']);
const displayAttrs = new Set(['title','label','alt','placeholder','href','aria-label']);
const sources=['data','sdkFullReference','Home','Features','BuildWithClaude','Developers','SdkDocs','shared'];
const pageMap={Home:'home',Features:'features',BuildWithClaude:'claude',Developers:'developers',SdkDocs:'sdk-docs'};
for(const name of sources){
 const path=dir+name+'.tsx', source=readFileSync(path,'utf8');
 if(source.includes('../cms/context')) throw Error('Already migrated');
 const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const edits=[], aliases=new Set();
 const components=file.statements.filter(n=>ts.isFunctionDeclaration(n)&&/^[A-Z]/.test(n.name?.text||'')&&n.body);
 const constants=[];
 for(const node of file.statements){
   if(ts.isVariableStatement(node)) for(const d of node.declarationList.declarations) if(ts.isIdentifier(d.name)) constants.push(d.name.text);
   if(ts.isImportDeclaration(node) && ['./data','./sdkFullReference'].includes(node.moduleSpecifier.text)) for(const spec of node.importClause?.namedBindings?.elements||[]) if(!spec.isTypeOnly) constants.push(spec.name.text);
 }
 function componentFor(node){for(let p=node;p;p=p.parent)if(components.includes(p))return p;return null;}
 function isHuman(node){
  const p=node.parent;
  if(ts.isPropertyAssignment(p) && p.initializer===node) return displayProps.has(p.name.getText(file).replace(/['"]/g,''));
  if(ts.isArrayLiteralExpression(p)) {let q=p;while(q.parent&&ts.isArrayLiteralExpression(q.parent))q=q.parent;return !ts.isPropertyAssignment(q.parent)||!['sectionIds','calls'].includes(q.parent.name.getText(file));}
  if(ts.isCallExpression(p)&&['m','it'].includes(p.expression.getText(file)))return true;
  if(ts.isJsxExpression(p) && !ts.isJsxAttribute(p.parent))return true;
  return false;
 }
 function visit(node){
  const comp=componentFor(node);
  if(ts.isJsxText(node)) {const value=clean(node.getText(file));if(value.trim()&&comp){register(value,name);edits.push([node.getStart(file),node.end,'{cms.text('+JSON.stringify(value)+')}']);}}
  else if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)){
    if(ts.isJsxAttribute(node.parent)&&displayAttrs.has(node.parent.name.getText(file))&&comp){const v=decode(node.text);register(v,name);edits.push([node.getStart(file),node.end,'{cms.'+(node.parent.name.getText(file)==='href'?'url':'text')+'('+JSON.stringify(v)+')}']);}
    else if(isHuman(node)&&node.text.trim()) {register(node.text,name);if(comp)edits.push([node.getStart(file),node.end,'cms.text('+JSON.stringify(node.text)+')']);}
  }
  ts.forEachChild(node,visit);
 }
 visit(file);
 for(const comp of components){
  const used=new Set();function refs(n){if(ts.isIdentifier(n)&&constants.includes(n.text)) used.add(n.text);ts.forEachChild(n,refs);}refs(comp.body);
  let inject='\n  const cms = useCms();';
  for(const name of used){aliases.add(name);inject+='\n  const '+name+' = cms.data(CMS_DEFAULT_'+name+');';}
  edits.push([comp.body.getStart(file)+1,comp.body.getStart(file)+1,inject+'\n']);
  if(pageMap[comp.name.text]) {
    const ret=comp.body.statements.find(n=>ts.isReturnStatement(n));let root=ret?.expression;
    if(root&&ts.isParenthesizedExpression(root))root=root.expression;
    if(root&&ts.isJsxFragment(root)){
      const children=root.children.filter(n=>ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n));
      pages[pageMap[comp.name.text]]=children.map((n,i)=>{
        const txt=n.getText(file);const heading=txt.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/)?.[1]?.replace(/<[^>]+>/g,' ').replace(/\{[^}]+\}/g,' ').replace(/\s+/g,' ').trim();
        return heading?.slice(0,90)||((ts.isJsxSelfClosingElement(n)?n.tagName.getText(file):'Section '+(i+1)).replace(/([a-z])([A-Z])/g,'$1 $2'));
      });
      edits.push([root.openingFragment.getStart(file),root.openingFragment.end,'<CmsLayout page="'+pageMap[comp.name.text]+'">'],[root.closingFragment.getStart(file),root.closingFragment.end,'</CmsLayout>']);
    }
  }
 }
 if(components.length){
  edits.sort((a,b)=>b[0]-a[0]);let next=source;for(const [start,end,value]of edits)next=next.slice(0,start)+value+next.slice(end);
  next="import { useCms } from '../cms/context';\n"+(pageMap[name]?"import { CmsLayout } from '../cms/Sections';\n":'')+next;
  for(const name of aliases)next+='\nconst CMS_DEFAULT_'+name+' = '+name+';';
  writeFileSync(path,next+'\n');
 }
}
writeFileSync('src/components/cms/catalog.json',JSON.stringify(catalog,null,2)+'\n');
writeFileSync('src/components/cms/native-pages.json',JSON.stringify(pages,null,2)+'\n');
console.log(Object.keys(catalog).length+' editable copy fields; '+Object.keys(pages).length+' original pages');
