import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, deleteObject } from 'firebase/storage';
import { defaultContent } from '../../src/components/cms/model';
let env:RulesTestEnvironment;
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
describe.skipIf(!enabled)('CMS production rules against isolated Firebase emulators',()=>{
  beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-polyform-cms',firestore:{host:'127.0.0.1',port:8188,rules:readFileSync('firestore.rules','utf8')},storage:{host:'127.0.0.1',port:9298,rules:readFileSync('storage.rules','utf8')}});},30000);
  beforeEach(async()=>{await env.clearFirestore();});
  afterAll(async()=>{await env?.cleanup();});
  const admin=()=>env.authenticatedContext('admin',{email:'craigtrickett@gmail.com',email_verified:true});
  const entry=()=>({content:defaultContent(),revision:1,updatedBy:'admin',updatedAt:serverTimestamp()});
  it('denies anonymous, ordinary and unverified draft access and all CMS writes',async()=>{
    for(const ctx of [env.unauthenticatedContext(),env.authenticatedContext('other',{email:'other@example.com',email_verified:true}),env.authenticatedContext('unverified',{email:'craigtrickett@gmail.com',email_verified:false})]){
      const db=ctx.firestore();await assertFails(getDoc(doc(db,'marketingCms','draft')));await assertFails(setDoc(doc(db,'marketingCms','draft'),entry()));await assertFails(setDoc(doc(db,'marketingCms','published'),{...entry(),draftRevision:1}));await assertFails(getDocs(collection(db,'marketingCmsHistory')));
    }
  });
  it('saves private drafts, requires an atomic publish and exposes only the published snapshot',async()=>{
    const db=admin().firestore(),draft=entry();await assertSucceeds(setDoc(doc(db,'marketingCms','draft'),draft));
    const live={...draft,draftRevision:1};await assertFails(setDoc(doc(db,'marketingCms','published'),live));
    const batch=writeBatch(db);batch.set(doc(db,'marketingCms','published'),live);batch.set(doc(db,'marketingCmsHistory','1'),live);await assertSucceeds(batch.commit());
    const publicDb=env.unauthenticatedContext().firestore();expect((await assertSucceeds(getDoc(doc(publicDb,'marketingCms','published')))).data()?.revision).toBe(1);
    await assertFails(getDocs(collection(publicDb,'marketingCms')));await assertFails(deleteDoc(doc(db,'marketingCmsHistory','1')));await assertFails(setDoc(doc(db,'marketingCmsHistory','1'),live));
    await assertFails(setDoc(doc(db,'marketingCms','draft'),entry()));await assertFails(setDoc(doc(db,'marketingCms','draft'),{...entry(),revision:2,content:{}}));
  });
  it('rejects publishing content different from the saved draft',async()=>{const db=admin().firestore();await setDoc(doc(db,'marketingCms','draft'),entry());const other=entry();other.content.pages[0].title='Not saved';const live={...other,draftRevision:1},b=writeBatch(db);b.set(doc(db,'marketingCms','published'),live);b.set(doc(db,'marketingCmsHistory','1'),live);await assertFails(b.commit());});
  it('only allows immutable raster uploads by the verified admin',async()=>{const storage=admin().storage(),asset=ref(storage,'marketing-media/test/image.png');await assertSucceeds(uploadBytes(asset,new Uint8Array([1,2,3]),{contentType:'image/png'}));await assertFails(uploadBytes(asset,new Uint8Array([4]),{contentType:'image/png'}));await assertFails(deleteObject(asset));await assertFails(uploadBytes(ref(storage,'marketing-media/test/vector.svg'),new Uint8Array([1]),{contentType:'image/svg+xml'}));await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(),'marketing-media/test/anon.png'),new Uint8Array([1]),{contentType:'image/png'}));});
  it('runs actual service transactions and detects concurrent draft/publication conflicts',async()=>{
    const db=admin().firestore();vi.doMock('../../src/firebase',()=>({db,auth:{currentUser:{uid:'admin',email:'craigtrickett@gmail.com',emailVerified:true}},storage:admin().storage()}));
    const service=await import('../../src/components/cms/service');const draft=await service.loadDraft();expect(draft.revision).toBe(0);const rev=await service.saveDraft(draft.content,0);expect(rev).toBe(1);await expect(service.saveDraft(draft.content,0)).rejects.toThrow(/Another session/);expect(await service.publishDraft(1,0)).toBe(1);await expect(service.publishDraft(1,0)).rejects.toThrow(/changed/);expect((await service.loadDraft()).content).toEqual(draft.content);
  },20000);
});
