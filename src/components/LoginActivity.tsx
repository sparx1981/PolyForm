import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Loader2, Search, ShieldAlert, X, XCircle } from 'lucide-react';
import { useApp } from '../AppContext';
import { db } from '../firebase';
import { LOGIN_ACTIVITY_ADMIN_EMAIL, type LoginActivityRecord, type LoginMethod } from '../lib/loginActivity';
import { useModalA11y } from './ui/useModalA11y';
import { cn, safelyToDate } from '../lib/utils';

type SortKey = 'timestamp' | 'email' | 'success' | 'method';
type StatusFilter = 'all' | 'success' | 'failure';
type MethodFilter = 'all' | LoginMethod;

const PAGE_SIZE = 1000;

export default function LoginActivity() {
  const { user, isLoginActivityOpen, setIsLoginActivityOpen } = useApp();
  const isAdmin = user?.email?.toLowerCase() === LOGIN_ACTIVITY_ADMIN_EMAIL;

  const [records, setRecords] = useState<LoginActivityRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const containerRef = useModalA11y<HTMLDivElement>(isLoginActivityOpen, () => setIsLoginActivityOpen(false));

  useEffect(() => {
    if (!isLoginActivityOpen || !isAdmin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'loginActivity'), orderBy('timestamp', 'desc'), limit(PAGE_SIZE)));
        if (cancelled) return;
        setRecords(snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            email: data.email || '',
            success: !!data.success,
            method: (data.method || 'password') as LoginMethod,
            reason: data.reason || undefined,
            userAgent: data.userAgent || undefined,
            timestamp: safelyToDate(data.timestamp),
          };
        }));
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load login activity.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isLoginActivityOpen, isAdmin]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = records.filter(r => {
      if (q && !r.email.toLowerCase().includes(q)) return false;
      if (statusFilter === 'success' && !r.success) return false;
      if (statusFilter === 'failure' && r.success) return false;
      if (methodFilter !== 'all' && r.method !== methodFilter) return false;
      return true;
    });
    rows = rows.slice().sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'timestamp') cmp = a.timestamp.getTime() - b.timestamp.getTime();
      else if (sortKey === 'email') cmp = a.email.localeCompare(b.email);
      else if (sortKey === 'success') cmp = Number(a.success) - Number(b.success);
      else if (sortKey === 'method') cmp = a.method.localeCompare(b.method);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [records, search, statusFilter, methodFilter, sortKey, sortDir]);

  const summary = useMemo(() => ({
    total: filtered.length,
    success: filtered.filter(r => r.success).length,
    failure: filtered.filter(r => !r.success).length,
  }), [filtered]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'timestamp' ? 'desc' : 'asc');
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown size={12} className="text-gray-300" />;
    return sortDir === 'asc' ? <ArrowUp size={12} className="text-polyform-blue" /> : <ArrowDown size={12} className="text-polyform-blue" />;
  };

  if (!isLoginActivityOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) setIsLoginActivityOpen(false); }}
      >
        <motion.div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-activity-title"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="w-full max-w-5xl max-h-[85vh] bg-white rounded-xl shadow-modus-4 border border-gray-200 flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 id="login-activity-title" className="text-lg font-bold text-polyform-gray flex items-center gap-2">
              <ShieldAlert size={18} className="text-polyform-blue" /> Login Activity
            </h2>
            <button
              type="button"
              onClick={() => setIsLoginActivityOpen(false)}
              aria-label="Close"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            >
              <X size={18} />
            </button>
          </div>

          {!isAdmin ? (
            <div className="p-8 text-center text-gray-500">You don&rsquo;t have access to this panel.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-light">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="px-2.5 py-1 rounded-md bg-white border border-gray-200">Total <span className="text-polyform-dark-blue">{summary.total}</span></span>
                  <span className="px-2.5 py-1 rounded-md bg-white border border-gray-200 flex items-center gap-1"><CheckCircle2 size={13} className="text-polyform-green" /> Success <span className="text-polyform-green">{summary.success}</span></span>
                  <span className="px-2.5 py-1 rounded-md bg-white border border-gray-200 flex items-center gap-1"><XCircle size={13} className="text-polyform-red" /> Failed <span className="text-polyform-red">{summary.failure}</span></span>
                </div>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="search"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Filter by email"
                      className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-polyform-blue focus:border-transparent w-48"
                    />
                  </div>
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                    className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-polyform-blue"
                  >
                    <option value="all">All outcomes</option>
                    <option value="success">Success only</option>
                    <option value="failure">Failures only</option>
                  </select>
                  <select
                    value={methodFilter}
                    onChange={e => setMethodFilter(e.target.value as MethodFilter)}
                    className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-polyform-blue"
                  >
                    <option value="all">All methods</option>
                    <option value="google">Google</option>
                    <option value="password">Email/password</option>
                  </select>
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                {loading ? (
                  <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="animate-spin" size={24} /></div>
                ) : error ? (
                  <div className="p-8 text-center text-polyform-red text-sm">{error}</div>
                ) : filtered.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">No login activity matches these filters.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                      <tr>
                        <Th label="When" active={sortKey === 'timestamp'} onClick={() => toggleSort('timestamp')}><SortIcon column="timestamp" /></Th>
                        <Th label="Email" active={sortKey === 'email'} onClick={() => toggleSort('email')}><SortIcon column="email" /></Th>
                        <Th label="Outcome" active={sortKey === 'success'} onClick={() => toggleSort('success')}><SortIcon column="success" /></Th>
                        <Th label="Method" active={sortKey === 'method'} onClick={() => toggleSort('method')}><SortIcon column="method" /></Th>
                        <th className="text-left font-semibold px-4 py-2.5">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(r => (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.timestamp.getTime() > 0 ? r.timestamp.toLocaleString() : '—'}</td>
                          <td className="px-4 py-2.5 text-gray-800 font-medium truncate max-w-[220px]" title={r.email}>{r.email || '—'}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                              r.success ? 'bg-green-50 text-polyform-green' : 'bg-red-50 text-polyform-red',
                            )}>
                              {r.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                              {r.success ? 'Success' : 'Failed'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 capitalize">{r.method === 'google' ? 'Google' : 'Email/password'}</td>
                          <td className="px-4 py-2.5 text-gray-500 font-mono text-xs truncate max-w-[240px]" title={r.reason || ''}>{r.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Th({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <th className="text-left font-semibold px-4 py-2.5">
      <button type="button" onClick={onClick} className={cn('flex items-center gap-1 hover:text-polyform-blue transition-colors', active && 'text-polyform-blue')}>
        {label} {children}
      </button>
    </th>
  );
}
