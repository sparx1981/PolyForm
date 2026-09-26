import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown, ArrowUp, ArrowUpDown, BarChart3, CheckCircle2, Eye, Globe2, Loader2,
  LogIn, Search, ShieldAlert, TrendingDown, TrendingUp, Users, X, XCircle,
} from 'lucide-react';
import { useApp } from '../AppContext';
import { db } from '../firebase';
import { LOGIN_ACTIVITY_ADMIN_EMAIL, type LoginActivityRecord, type LoginMethod } from '../lib/loginActivity';
import { type MarketingPage, type WebsiteActivityRecord } from '../lib/websiteActivity';
import { useModalA11y } from './ui/useModalA11y';
import { cn, safelyToDate } from '../lib/utils';

type Tab = 'login' | 'website';

type LoginSortKey = 'timestamp' | 'email' | 'success' | 'method';
type StatusFilter = 'all' | 'success' | 'failure';
type MethodFilter = 'all' | LoginMethod;

type WebsiteSortKey = 'timestamp' | 'page' | 'device' | 'referrer' | 'visitorId';
type WebsiteDeviceFilter = 'all' | WebsiteActivityRecord['device'];
type WebsitePageFilter = 'all' | MarketingPage;
type PeriodDays = 7 | 30 | 90;

const LOGIN_PAGE_SIZE = 1000;
const WEBSITE_PAGE_SIZE = 10000;

const PAGE_LABELS: Record<MarketingPage, string> = {
  home: 'Home',
  features: 'Product',
  claude: 'AI',
  developers: 'Developers',
  'sdk-docs': 'SDK',
};

function pctChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? null : 100;
  return ((current - previous) / previous) * 100;
}

function Metric({
  label,
  value,
  previous,
  icon,
  suffix = '',
}: {
  label: string;
  value: number;
  previous: number;
  icon: React.ReactNode;
  suffix?: string;
}) {
  const change = pctChange(value, previous);
  const up = change != null && change > 0;
  const down = change != null && change < 0;

  return (
    <div className="min-w-[150px] flex-1 rounded-lg border border-gray-200 bg-white px-3.5 py-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
        <span className="text-polyform-blue">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 flex items-end gap-2">
        <span className="text-xl font-bold text-polyform-dark-blue">{value.toLocaleString()}{suffix}</span>
        <span className={cn(
          'mb-0.5 inline-flex items-center gap-0.5 text-[11px] font-semibold',
          up && 'text-polyform-green',
          down && 'text-polyform-red',
          change === 0 && 'text-gray-400',
          change == null && 'text-gray-400',
        )}>
          {up && <TrendingUp size={12} />}
          {down && <TrendingDown size={12} />}
          {change == null ? '—' : (change > 0 ? '+' : '') + change.toFixed(0) + '%'}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-gray-400">vs previous period: {previous.toLocaleString()}{suffix}</div>
    </div>
  );
}

export default function LoginActivity() {
  const { user, isLoginActivityOpen, setIsLoginActivityOpen } = useApp();
  const isAdmin = user?.email?.toLowerCase() === LOGIN_ACTIVITY_ADMIN_EMAIL;
  const [tab, setTab] = useState<Tab>('login');

  const [records, setRecords] = useState<LoginActivityRecord[]>([]);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('all');
  const [sortKey, setSortKey] = useState<LoginSortKey>('timestamp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [websiteRecords, setWebsiteRecords] = useState<WebsiteActivityRecord[]>([]);
  const [websiteLoading, setWebsiteLoading] = useState(false);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [websiteSearch, setWebsiteSearch] = useState('');
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30);
  const [pageFilter, setPageFilter] = useState<WebsitePageFilter>('all');
  const [deviceFilter, setDeviceFilter] = useState<WebsiteDeviceFilter>('all');
  const [websiteSortKey, setWebsiteSortKey] = useState<WebsiteSortKey>('timestamp');
  const [websiteSortDir, setWebsiteSortDir] = useState<'asc' | 'desc'>('desc');

  const containerRef = useModalA11y<HTMLDivElement>(isLoginActivityOpen, () => setIsLoginActivityOpen(false));

  useEffect(() => {
    if (!isLoginActivityOpen || !isAdmin) return;
    let cancelled = false;
    setLoginLoading(true);
    setLoginError(null);
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'loginActivity'), orderBy('timestamp', 'desc'), limit(LOGIN_PAGE_SIZE)));
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
        if (!cancelled) setLoginError(err?.message || 'Failed to load login activity.');
      } finally {
        if (!cancelled) setLoginLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isLoginActivityOpen, isAdmin]);

  useEffect(() => {
    if (!isLoginActivityOpen || !isAdmin || tab !== 'website') return;
    let cancelled = false;
    setWebsiteLoading(true);
    setWebsiteError(null);

    const previousStart = new Date();
    previousStart.setDate(previousStart.getDate() - periodDays * 2);

    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'websiteActivity'),
          where('timestamp', '>=', Timestamp.fromDate(previousStart)),
          orderBy('timestamp', 'desc'),
          limit(WEBSITE_PAGE_SIZE),
        ));
        if (cancelled) return;
        setWebsiteRecords(snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            visitorId: data.visitorId || '',
            sessionId: data.sessionId || '',
            page: (data.page || 'home') as MarketingPage,
            path: data.path || '/',
            referrer: data.referrer || undefined,
            device: (data.device || 'desktop') as WebsiteActivityRecord['device'],
            timestamp: safelyToDate(data.timestamp),
          };
        }));
      } catch (err: any) {
        if (!cancelled) setWebsiteError(err?.message || 'Failed to load website activity.');
      } finally {
        if (!cancelled) setWebsiteLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isLoginActivityOpen, isAdmin, tab, periodDays]);

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

  const loginSummary = useMemo(() => ({
    total: filtered.length,
    success: filtered.filter(r => r.success).length,
    failure: filtered.filter(r => !r.success).length,
  }), [filtered]);

  const websitePeriods = useMemo(() => {
    const now = Date.now();
    const periodMs = periodDays * 24 * 60 * 60 * 1000;
    const currentStart = now - periodMs;
    const previousStart = now - periodMs * 2;

    const matchesFilters = (r: WebsiteActivityRecord) => {
      if (pageFilter !== 'all' && r.page !== pageFilter) return false;
      if (deviceFilter !== 'all' && r.device !== deviceFilter) return false;
      return true;
    };

    return {
      current: websiteRecords.filter(r => r.timestamp.getTime() >= currentStart && matchesFilters(r)),
      previous: websiteRecords.filter(r => r.timestamp.getTime() >= previousStart && r.timestamp.getTime() < currentStart && matchesFilters(r)),
    };
  }, [websiteRecords, periodDays, pageFilter, deviceFilter]);

  const websiteSummary = useMemo(() => {
    const summarise = (rows: WebsiteActivityRecord[]) => {
      const visitors = new Set(rows.map(r => r.visitorId)).size;
      const sessions = new Set(rows.map(r => r.sessionId)).size;
      const views = rows.length;
      return {
        visitors,
        sessions,
        views,
        pagesPerSession: sessions ? views / sessions : 0,
      };
    };
    return {
      current: summarise(websitePeriods.current),
      previous: summarise(websitePeriods.previous),
    };
  }, [websitePeriods]);

  const websiteFiltered = useMemo(() => {
    const q = websiteSearch.trim().toLowerCase();
    const rows = websitePeriods.current.filter(r => {
      if (!q) return true;
      return (
        r.path.toLowerCase().includes(q)
        || (r.referrer || '').toLowerCase().includes(q)
        || r.visitorId.toLowerCase().includes(q)
        || r.sessionId.toLowerCase().includes(q)
      );
    });

    return rows.slice().sort((a, b) => {
      let cmp = 0;
      if (websiteSortKey === 'timestamp') cmp = a.timestamp.getTime() - b.timestamp.getTime();
      else if (websiteSortKey === 'page') cmp = a.page.localeCompare(b.page);
      else if (websiteSortKey === 'device') cmp = a.device.localeCompare(b.device);
      else if (websiteSortKey === 'referrer') cmp = (a.referrer || '').localeCompare(b.referrer || '');
      else if (websiteSortKey === 'visitorId') cmp = a.visitorId.localeCompare(b.visitorId);
      return websiteSortDir === 'asc' ? cmp : -cmp;
    });
  }, [websitePeriods.current, websiteSearch, websiteSortKey, websiteSortDir]);

  const toggleLoginSort = (key: LoginSortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'timestamp' ? 'desc' : 'asc');
    }
  };

  const toggleWebsiteSort = (key: WebsiteSortKey) => {
    if (websiteSortKey === key) setWebsiteSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setWebsiteSortKey(key);
      setWebsiteSortDir(key === 'timestamp' ? 'desc' : 'asc');
    }
  };

  const LoginSortIcon = ({ column }: { column: LoginSortKey }) => {
    if (sortKey !== column) return <ArrowUpDown size={12} className="text-gray-300" />;
    return sortDir === 'asc' ? <ArrowUp size={12} className="text-polyform-blue" /> : <ArrowDown size={12} className="text-polyform-blue" />;
  };

  const WebsiteSortIcon = ({ column }: { column: WebsiteSortKey }) => {
    if (websiteSortKey !== column) return <ArrowUpDown size={12} className="text-gray-300" />;
    return websiteSortDir === 'asc' ? <ArrowUp size={12} className="text-polyform-blue" /> : <ArrowDown size={12} className="text-polyform-blue" />;
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
          aria-labelledby="activity-title"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="w-full max-w-7xl max-h-[88vh] bg-white rounded-xl shadow-modus-4 border border-gray-200 flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <h2 id="activity-title" className="text-lg font-bold text-polyform-gray flex items-center gap-2">
                <ShieldAlert size={18} className="text-polyform-blue" /> Activity
              </h2>
              <p className="mt-0.5 text-xs text-gray-400">Sign-in monitoring and marketing website analytics.</p>
            </div>
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
              <div className="flex gap-1 px-5 pt-3 border-b border-gray-100">
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  className={cn(
                    'inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold border-b-2 transition-colors',
                    tab === 'login' ? 'border-polyform-blue text-polyform-dark-blue' : 'border-transparent text-gray-500 hover:text-gray-800',
                  )}
                >
                  <LogIn size={15} /> Login Activity
                </button>
                <button
                  type="button"
                  onClick={() => setTab('website')}
                  className={cn(
                    'inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold border-b-2 transition-colors',
                    tab === 'website' ? 'border-polyform-blue text-polyform-dark-blue' : 'border-transparent text-gray-500 hover:text-gray-800',
                  )}
                >
                  <BarChart3 size={15} /> Website Activity
                </button>
              </div>

              {tab === 'login' ? (
                <>
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-light">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <span className="px-2.5 py-1 rounded-md bg-white border border-gray-200">Total <span className="text-polyform-dark-blue">{loginSummary.total}</span></span>
                      <span className="px-2.5 py-1 rounded-md bg-white border border-gray-200 flex items-center gap-1"><CheckCircle2 size={13} className="text-polyform-green" /> Success <span className="text-polyform-green">{loginSummary.success}</span></span>
                      <span className="px-2.5 py-1 rounded-md bg-white border border-gray-200 flex items-center gap-1"><XCircle size={13} className="text-polyform-red" /> Failed <span className="text-polyform-red">{loginSummary.failure}</span></span>
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
                    {loginLoading ? (
                      <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="animate-spin" size={24} /></div>
                    ) : loginError ? (
                      <div className="p-8 text-center text-polyform-red text-sm">{loginError}</div>
                    ) : filtered.length === 0 ? (
                      <div className="p-8 text-center text-gray-500 text-sm">No login activity matches these filters.</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-white border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                          <tr>
                            <Th label="When" active={sortKey === 'timestamp'} onClick={() => toggleLoginSort('timestamp')}><LoginSortIcon column="timestamp" /></Th>
                            <Th label="Email" active={sortKey === 'email'} onClick={() => toggleLoginSort('email')}><LoginSortIcon column="email" /></Th>
                            <Th label="Outcome" active={sortKey === 'success'} onClick={() => toggleLoginSort('success')}><LoginSortIcon column="success" /></Th>
                            <Th label="Method" active={sortKey === 'method'} onClick={() => toggleLoginSort('method')}><LoginSortIcon column="method" /></Th>
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
              ) : (
                <>
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-light">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Metric label="Visitors" value={websiteSummary.current.visitors} previous={websiteSummary.previous.visitors} icon={<Users size={14} />} />
                      <Metric label="Sessions" value={websiteSummary.current.sessions} previous={websiteSummary.previous.sessions} icon={<Globe2 size={14} />} />
                      <Metric label="Page views" value={websiteSummary.current.views} previous={websiteSummary.previous.views} icon={<Eye size={14} />} />
                      <Metric
                        label="Pages / session"
                        value={Number(websiteSummary.current.pagesPerSession.toFixed(1))}
                        previous={Number(websiteSummary.previous.pagesPerSession.toFixed(1))}
                        icon={<BarChart3 size={14} />}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        value={periodDays}
                        onChange={e => setPeriodDays(Number(e.target.value) as PeriodDays)}
                        className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-polyform-blue"
                      >
                        <option value={7}>Last 7 days</option>
                        <option value={30}>Last 30 days</option>
                        <option value={90}>Last 90 days</option>
                      </select>
                      <select
                        value={pageFilter}
                        onChange={e => setPageFilter(e.target.value as WebsitePageFilter)}
                        className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-polyform-blue"
                      >
                        <option value="all">All marketing pages</option>
                        {Object.entries(PAGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                      <select
                        value={deviceFilter}
                        onChange={e => setDeviceFilter(e.target.value as WebsiteDeviceFilter)}
                        className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-polyform-blue"
                      >
                        <option value="all">All devices</option>
                        <option value="desktop">Desktop</option>
                        <option value="tablet">Tablet</option>
                        <option value="mobile">Mobile</option>
                      </select>
                      <div className="relative sm:ml-auto">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="search"
                          value={websiteSearch}
                          onChange={e => setWebsiteSearch(e.target.value)}
                          placeholder="Filter path, referrer or visitor"
                          className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-polyform-blue focus:border-transparent w-[250px] max-w-full"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto">
                    {websiteLoading ? (
                      <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="animate-spin" size={24} /></div>
                    ) : websiteError ? (
                      <div className="p-8 text-center text-polyform-red text-sm">{websiteError}</div>
                    ) : websiteFiltered.length === 0 ? (
                      <div className="p-8 text-center text-gray-500 text-sm">No website activity matches these filters.</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-white border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                          <tr>
                            <Th label="When" active={websiteSortKey === 'timestamp'} onClick={() => toggleWebsiteSort('timestamp')}><WebsiteSortIcon column="timestamp" /></Th>
                            <Th label="Page" active={websiteSortKey === 'page'} onClick={() => toggleWebsiteSort('page')}><WebsiteSortIcon column="page" /></Th>
                            <th className="text-left font-semibold px-4 py-2.5">Path</th>
                            <Th label="Device" active={websiteSortKey === 'device'} onClick={() => toggleWebsiteSort('device')}><WebsiteSortIcon column="device" /></Th>
                            <Th label="Referrer" active={websiteSortKey === 'referrer'} onClick={() => toggleWebsiteSort('referrer')}><WebsiteSortIcon column="referrer" /></Th>
                            <Th label="Visitor" active={websiteSortKey === 'visitorId'} onClick={() => toggleWebsiteSort('visitorId')}><WebsiteSortIcon column="visitorId" /></Th>
                          </tr>
                        </thead>
                        <tbody>
                          {websiteFiltered.map(r => (
                            <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.timestamp.getTime() > 0 ? r.timestamp.toLocaleString() : '—'}</td>
                              <td className="px-4 py-2.5 font-semibold text-polyform-dark-blue">{PAGE_LABELS[r.page] || r.page}</td>
                              <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{r.path}</td>
                              <td className="px-4 py-2.5 text-gray-600 capitalize">{r.device}</td>
                              <td className="px-4 py-2.5 text-gray-500 truncate max-w-[220px]" title={r.referrer || 'Direct'}>{r.referrer || 'Direct'}</td>
                              <td className="px-4 py-2.5 text-gray-400 font-mono text-[10px] truncate max-w-[150px]" title={r.visitorId}>{r.visitorId}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
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
