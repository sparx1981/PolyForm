import React, { useEffect, useState } from 'react';
import { Cloud, HardDrive, Building2, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { storageProviders, STORAGE_LABELS } from '../lib/storage/registry';
import type { StorageFolder, StorageLocation } from '../lib/storage/providers';

const OPTIONS: { id: StorageLocation; hint: string; icon: React.ReactNode }[] = [
  { id: 'polyform', hint: 'Live collaboration and Claude. Best for smaller models.', icon: <Cloud size={16} /> },
  { id: 'google-drive', hint: 'A .polyform file in your Drive’s PolyForm folder. No size limit.', icon: <HardDrive size={16} /> },
  { id: 'trimble-connect', hint: 'A .polyform file in a Trimble Connect project, with versions.', icon: <Building2 size={16} /> },
];

interface Props {
  value: StorageLocation;
  onChange: (value: StorageLocation) => void;
  folder: StorageFolder | null;
  onFolder: (folder: StorageFolder | null) => void;
}

/** "Save to" choice in the Save As dialog, with Trimble Connect's folder picker. */
export default function StorageChoice({ value, onChange, folder, onFolder }: Props) {
  const [folders, setFolders] = useState<StorageFolder[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const trimble = storageProviders['trimble-connect'];

  const loadFolders = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const list = await trimble.listFolders!();
      setFolders(list);
      if (list.length && !folder) onFolder(list[0]);
      if (!list.length) setProblem('No Trimble Connect projects found for this account.');
    } catch (e: any) {
      setProblem(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (value === 'trimble-connect' && trimble.connected() && folders === null) loadFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="space-y-2" id="storage-choice">
      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Save to</label>
      <div className="grid gap-2">
        {OPTIONS.map(option => {
          const provider = option.id === 'polyform' ? null : storageProviders[option.id];
          const needsSetup = provider ? !provider.configured() : false;
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              id={`storage-${option.id}`}
              disabled={needsSetup}
              onClick={() => onChange(option.id)}
              className={cn(
                'flex items-start gap-3 p-3 rounded-xl border text-left transition-colors',
                selected ? 'border-polyform-blue bg-polyform-blue/5' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
                needsSetup && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span className={cn('mt-0.5', selected ? 'text-polyform-blue' : 'text-gray-400')}>{option.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
                  {STORAGE_LABELS[option.id]}
                  {needsSetup && <span className="ml-2 text-[10px] font-bold uppercase text-amber-600">Needs setup</span>}
                  {provider && !needsSetup && provider.connected() && <span className="ml-2 text-[10px] font-bold uppercase text-emerald-600">Connected</span>}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{option.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {value === 'google-drive' && !storageProviders['google-drive'].connected() && (
        <p className="text-xs text-gray-500">You’ll be asked to allow PolyForm to manage the files it creates in your Drive.</p>
      )}

      {value === 'trimble-connect' && (
        <div className="space-y-2 pt-1">
          {!trimble.connected() ? (
            <button
              type="button"
              onClick={async () => {
                setProblem(null);
                try {
                  await trimble.connect();
                  await loadFolders();
                } catch (e: any) {
                  setProblem(e?.message ?? String(e));
                }
              }}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900"
            >
              Sign in with Trimble
            </button>
          ) : busy ? (
            <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading projects…</div>
          ) : folders && folders.length > 0 ? (
            <select
              value={folder?.id ?? ''}
              onChange={e => onFolder(folders.find(f => f.id === e.target.value) ?? null)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
            >
              {folders.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          ) : null}
          {problem && <p className="text-xs text-red-600">{problem}</p>}
        </div>
      )}
    </div>
  );
}
