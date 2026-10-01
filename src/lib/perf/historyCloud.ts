import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import { cloudRun, isPerfRun, MAX_HISTORY_RUNS } from './history';
import type { PerfRun } from './profilerStore';
import { diagnose } from './profilerCore';
export async function saveBenchmarkCloud(uid:string,run:PerfRun){
  if(auth.currentUser?.uid!==uid)throw new Error('Sign in to save benchmark history.');
  const payload=cloudRun(run);
  if(new TextEncoder().encode(JSON.stringify(payload)).length>200_000)throw new Error('Benchmark exceeds the cloud record size limit.');
  const {app:_app,...data}=payload;
  await setDoc(doc(db,'users',uid,'perfRuns',run.id),{...data,schemaVersion:1,savedAt:serverTimestamp()});
}
/** Standard ordered listener is required here for live cross-device history and offline cached reads. */
export function watchBenchmarkCloud(uid:string,onRuns:(runs:PerfRun[])=>void,onError:(error:Error)=>void){
  if(auth.currentUser?.uid!==uid)throw new Error('Sign in to load benchmark history.');
  return onSnapshot(query(collection(db,'users',uid,'perfRuns'),orderBy('startedAt','desc'),limit(MAX_HISTORY_RUNS)),snapshot=>{
    const runs=snapshot.docs.filter(d=>d.data().schemaVersion===1).map(d=>({...d.data(),id:d.id,app:{url:''}})).filter(isPerfRun).map(r=>({...r,diagnosis:diagnose({stats:r.stats})}));
    onRuns(runs);
  },onError);
}
