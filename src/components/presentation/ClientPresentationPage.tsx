import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Hammer, Layers, Scissors, ScanEye, RotateCw, Maximize2, Download, FileSpreadsheet, Loader2, AlertTriangle, Ruler, Palette,
  Home, DoorOpen, Package, MessageSquare, MessageSquarePlus, MapPin, Box, Route,
} from 'lucide-react';
import { useApp } from '../../AppContext';
import Viewport from '../Viewport';
import { cn } from '../../lib/utils';
import { floorPlans, type FloorPlan, type PlanOpening } from '../../lib/presentation/floorPlans';
import { bomToCsv, type BomLine } from '../../lib/presentation/bom';
import { loadPresentation, ShareNotFoundError, type ClientPresentationBundle, type ClientPresentationDoc } from '../../lib/presentation/share';
import { playBuild, presentation, usePresentation } from '../../lib/presentation/store';
import { plantSpread } from '../../lib/presentation/plants';
import { downloadBlob } from '../../lib/presentation/recorder';
import { frameModel, Popover, Slider, Tool, cutRange } from './PresentationPanel';
import { SERIF, StageCaption, StageTimeline } from './StageTimeline';
import { LabelCallout, PinLayer } from './PinLayer';
import { TourPlayer } from './TourPlayer';
import { usePickOnModel } from './ContentEditor';
import { CommentComposer, CommentPinMarker, CommentThreads, pinNumbers } from './Comments';
import { postComment, watchComments, type PresentationComment } from '../../lib/presentation/comments';
import type { Shape } from '../../types';

const LEVEL_NAMES = ['Ground floor', 'First floor', 'Second floor', 'Third floor', 'Fourth floor'];
const levelName = (level: number) => LEVEL_NAMES[level - 1] ?? `Level ${level}`;
const FONT = 'Inter, ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';

/**
 * `/p/<shareId>`: the page a designer sends their client. The model in 3D (look around, and
 * play the effects the designer allowed), artistic and technical floor plans, rooms, the door
 * and window schedule and the quantities. Nothing on it can change the design.
 */
export default function ClientPresentationPage({ shareId }: { shareId: string }) {
  const app = useApp();
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<ClientPresentationDoc | null>(null);
  const [bundle, setBundle] = useState<ClientPresentationBundle | null>(null);
  const live = useRef(app);
  live.current = app;
  const { dusk } = usePresentation();
  const [comments, setComments] = useState<PresentationComment[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (status !== 'ready') return;
    return watchComments(shareId, setComments, () => {});
  }, [shareId, status]);

  useEffect(() => {
    let cancelled = false;
    presentation.set({ active: true });
    (async () => {
      try {
        const loaded = await loadPresentation(shareId);
        if (cancelled) return;
        setMeta(loaded.meta);
        setBundle(loaded.bundle);
        document.title = `${loaded.meta.title} · PolyForm`;
        const a = live.current;
        a.applyProjectState(loaded.bundle.project);
        a.setCurrentModelName(loaded.meta.title);
        const tidy = () => {
          const x = live.current;
          x.setGridEnabled(false);
          x.setAxisIndicatorEnabled(false);
          x.setMiniAxisIndicatorEnabled(false);
          x.setActiveTool('orbit');
        };
        tidy();
        setStatus('ready');
        // Terrain, fences and textures build over the next moments; frame once they're drawn,
        // and re-apply the view settings a signed-in visitor's own preferences may have changed.
        setTimeout(() => { if (!cancelled) { tidy(); frameModel(live.current.shapes); } }, 900);
        setTimeout(() => { if (!cancelled) tidy(); }, 2500);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ShareNotFoundError) setStatus('missing');
        else { setStatus('error'); setError(err instanceof Error ? err.message : String(err)); }
      }
    })();
    return () => { cancelled = true; presentation.reset(false); };
  }, [shareId]);

  // Look, don't touch: no keyboard shortcuts reach the editor, and nothing stays selected.
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Tab') return;
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', block, true);
    window.addEventListener('keyup', block, true);
    return () => {
      window.removeEventListener('keydown', block, true);
      window.removeEventListener('keyup', block, true);
    };
  }, []);
  useEffect(() => {
    if (app.selectedIds.length || app.selectedId) {
      app.setSelectedIds([]);
      app.setSelectedId(null);
    }
  }, [app.selectedIds, app.selectedId]);

  if (status === 'missing') return <Message title="This link is no longer active" body="The designer may have turned it off or replaced it. Ask them for a new link." />;
  if (status === 'error') return <Message title="The presentation could not be opened" body={error} />;

  return (
    <div id="client-presentation" className="fixed inset-0 overflow-y-auto bg-[#f7f5f1] text-slate-800" style={{ fontFamily: FONT }}>
      <style>{'#client-viewer #polyform-viewport > :not(:has(canvas)) { display: none !important; }'}</style>
      <header className="sticky top-0 z-30 bg-[#f7f5f1]/85 backdrop-blur border-b border-black/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 font-bold text-polyform-dark-blue">
            <span className="w-7 h-7 rounded-lg bg-polyform-blue text-white flex items-center justify-center"><Box size={15} /></span>
            PolyForm
          </span>
          {meta && (
            <nav className="hidden md:flex items-center gap-5 text-sm text-slate-600">
              <a href="#model" className="hover:text-slate-900">3D model</a>
              <a href="#plans" className="hover:text-slate-900">Floor plans</a>
              <a href="#rooms" className="hover:text-slate-900">Rooms</a>
              <a href="#quantities" className="hover:text-slate-900">Quantities</a>
            </nav>
          )}
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-6">
        {meta ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-polyform-blue mb-2">Design presentation</p>
            <h1 className="text-4xl sm:text-6xl tracking-tight text-slate-900" style={{ fontFamily: SERIF }}>{meta.title}</h1>
            <p className="mt-3 text-slate-600">
              {meta.designerName && <>Prepared by <b className="text-slate-800">{meta.designerName}</b></>}
              {meta.designerName && meta.clientName && ' for '}
              {!meta.designerName && meta.clientName && 'Prepared for '}
              {meta.clientName && <b className="text-slate-800">{meta.clientName}</b>}
              {(meta.designerName || meta.clientName) && ' · '}
              {new Date(meta.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </>
        ) : (
          <div className="h-24 w-2/3 rounded-xl bg-black/5 animate-pulse" />
        )}
      </section>

      <section id="model" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-16">
        <div id="client-viewer" className="relative h-[68vh] min-h-[380px] rounded-3xl overflow-hidden bg-slate-200 shadow-xl ring-1 ring-black/5">
          <div className="absolute inset-0 flex">
            <Viewport />
          </div>
          {status === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-100 text-slate-500">
              <Loader2 size={24} className="animate-spin" /> Loading the design…
            </div>
          )}
          {status === 'ready' && meta && <ViewerControls effects={meta.effects} shareId={shareId} comments={comments} onOpenComment={setHighlight} />}
          {status === 'ready' && <StageCaption className="absolute left-4 sm:left-6 bottom-40 sm:bottom-36 z-10" dark={dusk} />}
        </div>
        <p className="text-xs text-slate-500 mt-2 px-1">Drag to look around · right-drag or two fingers to move · scroll or pinch to zoom</p>
      </section>

      {meta && bundle && <Details meta={meta} bundle={bundle} />}
      {meta && <ClientCommentsSection shareId={shareId} designer={meta.designerName} comments={comments} highlight={highlight} />}

      <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-10 text-sm text-slate-500 flex flex-wrap items-center justify-between gap-3">
        <span>Made with <a href="/" className="font-semibold text-polyform-blue hover:underline">PolyForm</a></span>
        <span>This page is a read-only view of the design.</span>
      </footer>
    </div>
  );
}

function ViewerControls({ effects, shareId, comments, onOpenComment }: {
  effects: ClientPresentationDoc['effects'];
  shareId: string;
  comments: PresentationComment[];
  onOpenComment: (id: string) => void;
}) {
  const s = usePresentation();
  const app = useApp();
  const [open, setOpen] = useState<'explode' | 'cut' | 'comment' | null>(null);
  const [placing, setPlacing] = useState(false);
  const [anchor, setAnchor] = useState<[number, number, number] | null>(null);
  usePickOnModel(placing, p => { setAnchor(p); setPlacing(false); }, () => setPlacing(false));
  const pins = pinNumbers(comments);
  const [touring, setTouring] = useState(false);
  const building = s.storeys > 0;
  const range = cutRange(s);
  const { labels, tour } = app.presentationContent;
  return (
    <>
    <PinLayer hide={s.explode > 0.01 || s.buildPlaying || s.build < 1} pins={labels.map(l => ({
      id: l.id, position: l.position, node: <LabelCallout text={l.text} detail={l.detail} serif={SERIF} />,
    }))} />
    <PinLayer pins={[
      ...[...pins].map(([id, n]) => ({
        id: `c-${id}`, position: comments.find(c => c.id === id)!.anchor!,
        node: <CommentPinMarker n={n} onClick={() => {
          onOpenComment(id);
          document.getElementById(`comment-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }} />,
      })),
      ...(anchor ? [{ id: 'new-comment', position: anchor, node: <CommentPinMarker n={pins.size + 1} active /> }] : []),
    ]} />
    {touring && tour.length > 0 && <TourPlayer stops={tour} onClose={() => setTouring(false)} className="absolute left-4 top-4 z-10" />}
    <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-10 w-[min(560px,calc(100%-16px))] flex flex-col items-center" onPointerDown={e => e.stopPropagation()}>
      {!open && <StageTimeline className="w-full mb-2" />}
      {open === 'comment' && placing && (
        <div className="mb-2 flex items-center gap-3 rounded-full bg-[#2f3a33] text-white px-4 py-2 text-sm shadow-xl">
          <MapPin size={15} className="text-amber-300" /> Click the spot your comment is about
          <button onClick={() => setPlacing(false)} className="text-white/70 hover:text-white underline text-xs">skip</button>
        </div>
      )}
      {open === 'comment' && !placing && (
        <div className="mb-2 w-full rounded-2xl bg-[#f7f5f0]/95 backdrop-blur-md shadow-xl ring-1 ring-black/5 p-4 text-slate-800">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm font-bold">Leave a comment</span>
            <button onClick={() => { setPlacing(!placing); }} className={cn('flex items-center gap-1 text-xs font-semibold rounded-lg px-2 py-1', placing ? 'bg-[#b4553a] text-white' : 'text-[#b4553a] hover:bg-black/5')}>
              <MapPin size={13} /> {anchor ? 'Move the pin' : 'Pin it to a spot'}
            </button>
          </div>
          <CommentComposer compact anchor={anchor} onClearAnchor={() => setAnchor(null)}
            placeholder="A question or thought for your designer…"
            onSend={async (name, text) => {
              await postComment(shareId, { authorName: name, text, anchor });
              setAnchor(null);
              setOpen(null);
            }} />
        </div>
      )}
      {open === 'explode' && (
        <Popover title="Exploded view" hint="Floors and roof lifted apart">
          <Slider label="Spread" value={s.explode} min={0} max={1} step={0.01} onChange={v => presentation.set({ explode: v })} format={v => `${Math.round(v * 100)}%`} />
        </Popover>
      )}
      {open === 'cut' && (
        <Popover title="Cut view" hint="Slice through to see inside">
          <div className="flex gap-1 mb-3">
            {(['plan', 'section-x', 'section-z'] as const).map(m => (
              <button key={m} onClick={() => presentation.set({ cut: m })}
                className={cn('flex-1 px-2 py-1 rounded-md text-xs font-semibold', s.cut === m ? 'bg-polyform-blue text-white' : 'bg-white/10 text-white/80 hover:bg-white/20')}>
                {m === 'plan' ? 'From above' : m === 'section-x' ? 'Side ↔' : 'Side ↕'}
              </button>
            ))}
          </div>
          <Slider label={s.cut === 'plan' ? 'Height' : 'Position'} value={s.cutAt} min={range[0]} max={range[1]} step={0.01}
            onChange={v => presentation.set({ cutAt: v })} format={v => `${v.toFixed(2)} m`} />
        </Popover>
      )}
      <div className="flex items-center gap-1 rounded-2xl bg-slate-900/80 backdrop-blur-md px-2 py-2 shadow-2xl border border-white/10 text-white overflow-x-auto">
        {effects.build && <Tool icon={<Hammer size={18} />} label="Build" active={s.buildPlaying} onClick={() => (s.buildPlaying ? presentation.set({ buildPlaying: false, build: 1 }) : playBuild())} />}
        {effects.explode && building && (
          <Tool icon={<Layers size={18} />} label="Explode" active={s.explode > 0} onClick={() => {
            if (open === 'explode') { setOpen(null); presentation.set({ explode: 0 }); } else { setOpen('explode'); presentation.set({ explode: 1 }); }
          }} />
        )}
        {effects.cut && (
          <Tool icon={<Scissors size={18} />} label="Cut" active={s.cut !== 'off'} onClick={() => {
            if (open === 'cut') { setOpen(null); presentation.set({ cut: 'off' }); } else { setOpen('cut'); if (s.cut === 'off') presentation.set({ cut: 'plan' }); }
          }} />
        )}
        {effects.xray && <Tool icon={<ScanEye size={18} />} label="X-ray" active={s.xray} onClick={() => presentation.set({ xray: !s.xray })} />}
        <Tool icon={<RotateCw size={18} />} label="Orbit" active={app.autoOrbitEnabled} onClick={() => app.setAutoOrbitEnabled(!app.autoOrbitEnabled)} />
        <Tool icon={<MessageSquarePlus size={18} />} label="Comment" active={open === 'comment'} onClick={() => {
          if (open === 'comment') { setOpen(null); setPlacing(false); setAnchor(null); } else { setOpen('comment'); setPlacing(true); }
        }} />
        {tour.length > 0 && <Tool icon={<Route size={18} />} label="Tour" active={touring} onClick={() => setTouring(!touring)} />}
        <Tool icon={<Maximize2 size={18} />} label="Reset" onClick={() => { setOpen(null); setTouring(false); presentation.reset(true); frameModel(app.shapes); }} />
      </div>
    </div>
    </>
  );
}

function Details({ meta, bundle }: { meta: ClientPresentationDoc; bundle: ClientPresentationBundle }) {
  const shapes = (bundle.project.shapes ?? []) as Shape[];
  const labels = bundle.roomNames ?? [];
  const technical = useMemo(() => floorPlans(shapes, labels, 1100, {
    wallDimensions: true, openingTags: true, axisNote: false, fontFamily: FONT,
    title: level => `${levelName(level)}`,
  }), [bundle]);
  const artistic = useMemo(() => floorPlans(shapes, labels, 1100, {
    style: 'artistic', axisNote: false, fontFamily: FONT, plantSpread, title: level => levelName(level),
  }), [bundle]);
  const rooms = technical.flatMap(p => p.rooms.map(r => ({ ...r, level: p.level })));
  const openings = technical.flatMap(p => p.openings);
  const totalArea = rooms.reduce((a, r) => a + r.areaM2, 0);

  return (
    <>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat icon={<Home size={18} />} label="Floor area" value={totalArea ? `${totalArea.toFixed(1)} m²` : '–'} />
          <Stat icon={<Layers size={18} />} label="Storeys" value={String(technical.length || '–')} />
          <Stat icon={<DoorOpen size={18} />} label="Rooms" value={String(rooms.length || '–')} />
          <Stat icon={<Package size={18} />} label="Items in quantities" value={String(bundle.bom.length)} />
        </div>
        {meta.message && (
          <div className="mt-6 rounded-2xl bg-white p-5 sm:p-6 shadow-sm ring-1 ring-black/5 flex gap-4">
            <MessageSquare className="text-polyform-blue shrink-0 mt-0.5" size={20} />
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-1">A note from {meta.designerName || 'your designer'}</p>
              <p className="text-slate-700 whitespace-pre-line leading-relaxed">{meta.message}</p>
            </div>
          </div>
        )}
      </section>

      {technical.length > 0 && <Plans technical={technical} artistic={artistic} openings={openings} bom={bundle.bom} meta={meta} />}

      {rooms.length > 0 && (
        <section id="rooms" className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 scroll-mt-16">
          <SectionTitle eyebrow="Spaces" title="Rooms and areas" />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rooms.map((r, i) => (
              <div key={i} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <p className="text-xs text-slate-500">{levelName(r.level)}</p>
                <p className="font-semibold text-slate-900">{r.name || `Room ${i + 1}`}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-polyform-dark-blue">{r.areaM2.toFixed(1)} m²</p>
                <p className="text-xs text-slate-500">About {r.size[0].toFixed(1)} × {r.size[1].toFixed(1)} m</p>
                {r.usableM2 !== undefined && (
                  <p className="mt-1 text-xs text-slate-600">{r.usableM2.toFixed(1)} m² with 1.5 m or more headroom</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {openings.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-14">
          <SectionTitle eyebrow="Openings" title="Door and window schedule" />
          <Table
            head={['Mark', 'Type', 'Floor', 'Width', 'Height', 'Sill', 'Style']}
            align={['l', 'l', 'l', 'r', 'r', 'r', 'l']}
            rows={openings.map(o => [o.mark, o.kind === 'door' ? 'Door' : 'Window', levelName(o.level), `${Math.round(o.width * 1000)} mm`, `${Math.round(o.height * 1000)} mm`, o.kind === 'door' ? '–' : `${Math.round(o.sill * 1000)} mm`, o.style ? titleCase(o.style) : '–'])}
          />
        </section>
      )}

      <section id="quantities" className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 scroll-mt-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionTitle eyebrow="Bill of materials" title="Quantities" />
          {bundle.bom.length > 0 && (
            <button onClick={() => downloadBlob(new Blob([bomToCsv(bundle.bom)], { type: 'text/csv' }), `${slug(meta.title)}-quantities.csv`)}
              className="mb-5 flex items-center gap-2 px-4 py-2 rounded-xl bg-white ring-1 ring-black/10 text-sm font-semibold hover:bg-slate-50">
              <FileSpreadsheet size={16} /> Download spreadsheet (CSV)
            </button>
          )}
        </div>
        {bundle.bom.length ? <BomTables lines={bundle.bom} /> : <p className="text-slate-500">No measurable items in this design yet.</p>}
        <p className="text-xs text-slate-500 mt-3">Quantities are measured from the 3D model and are approximate. Wall areas are net of doors and windows.</p>
      </section>
    </>
  );
}

function ClientCommentsSection({ shareId, designer, comments, highlight }: {
  shareId: string; designer: string; comments: PresentationComment[]; highlight: string | null;
}) {
  return (
    <section id="comments" className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 scroll-mt-16">
      <SectionTitle eyebrow="Conversation" title="Comments" />
      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div>
          <CommentThreads
            comments={comments}
            canReply
            highlight={highlight}
            emptyText={`No comments yet. Leave one below, or use Comment in the 3D view to pin it to a spot. ${designer || 'Your designer'} will see it.`}
            onReply={async (text, replyTo) => {
              const name = (() => { try { return localStorage.getItem('polyform_comment_name') ?? ''; } catch { return ''; } })() || window.prompt('Your name') || '';
              await postComment(shareId, { authorName: name, text, replyTo });
            }}
          />
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <p className="text-sm font-semibold text-slate-900 mb-2">Add a comment</p>
          <CommentComposer onSend={(name, text) => postComment(shareId, { authorName: name, text })} compact />
        </div>
      </div>
    </section>
  );
}

function Plans({ technical, artistic, openings, bom, meta }: { technical: FloorPlan[]; artistic: FloorPlan[]; openings: PlanOpening[]; bom: BomLine[]; meta: ClientPresentationDoc }) {
  const [style, setStyle] = useState<'artistic' | 'technical'>('artistic');
  const [level, setLevel] = useState(technical[0].level);
  const [busy, setBusy] = useState(false);
  const plans = style === 'artistic' ? artistic : technical;
  const plan = plans.find(p => p.level === level) ?? plans[0];

  const pdf = async () => {
    setBusy(true);
    try {
      const { drawingSetPdf } = await import('../../lib/presentation/pdf');
      const subtitle = [meta.designerName && `Prepared by ${meta.designerName}`, meta.clientName && `for ${meta.clientName}`].filter(Boolean).join(' ');
      const blob = await drawingSetPdf({ title: meta.title, subtitle, plans: technical, openings, bom });
      downloadBlob(blob, `${slug(meta.title)}-drawings.pdf`);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="plans" className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 scroll-mt-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle eyebrow="Drawings" title="Floor plans" />
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Segmented<'artistic' | 'technical'> value={style} onChange={setStyle} options={[
            { id: 'artistic', label: 'Illustrated', icon: <Palette size={14} /> },
            { id: 'technical', label: 'Technical', icon: <Ruler size={14} /> },
          ]} />
          <button onClick={pdf} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-polyform-blue text-white text-sm font-semibold shadow disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download PDF
          </button>
        </div>
      </div>
      {technical.length > 1 && (
        <div className="flex gap-2 mb-3 overflow-x-auto">
          {technical.map(p => (
            <button key={p.level} onClick={() => setLevel(p.level)}
              className={cn('px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap', level === p.level ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-black/10 text-slate-700')}>
              {levelName(p.level)}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-3xl bg-white shadow-sm ring-1 ring-black/5 p-2 sm:p-4 overflow-hidden">
        {/* Our own SVG, drawn from the model's numbers; every string in it is escaped. */}
        <div className="[&>svg]:w-full [&>svg]:h-auto" dangerouslySetInnerHTML={{ __html: plan.svg }} />
      </div>
    </section>
  );
}

function BomTables({ lines }: { lines: BomLine[] }) {
  const groups = [...new Set(lines.map(l => l.group))];
  return (
    <div className="space-y-5">
      {groups.map(g => (
        <div key={g}>
          <h3 className="text-sm font-bold text-slate-700 mb-2">{g}</h3>
          <Table head={['Item', 'Detail', 'Quantity']} align={['l', 'l', 'r']}
            rows={lines.filter(l => l.group === g).map(l => [l.item, l.detail ?? '–', `${formatQty(l.qty, l.unit)} ${l.unit}`])} />
        </div>
      ))}
    </div>
  );
}

function Table({ head, rows, align }: { head: string[]; rows: string[][]; align: ('l' | 'r')[] }) {
  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
          <tr>{head.map((h, i) => <th key={h} className={cn('px-4 py-2.5 font-semibold', align[i] === 'r' ? 'text-right' : 'text-left')}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => <td key={j} className={cn('px-4 py-2.5', align[j] === 'r' ? 'text-right tabular-nums whitespace-nowrap' : 'text-left', j === 0 && 'font-medium text-slate-900')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; icon?: React.ReactNode }[] }) {
  return (
    <div className="flex rounded-xl bg-white ring-1 ring-black/10 p-1">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold', value === o.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900')}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-polyform-blue mb-1">{eyebrow}</p>
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">{title}</h2>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold">{icon}{label}</div>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#f7f5f1] p-6 text-center" style={{ fontFamily: FONT }}>
      <div className="max-w-md">
        <AlertTriangle className="mx-auto text-amber-500 mb-3" size={28} />
        <h1 className="text-xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-slate-600">{body}</p>
        <a href="/" className="inline-block mt-6 text-sm font-semibold text-polyform-blue hover:underline">Go to PolyForm</a>
      </div>
    </div>
  );
}

const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const slug = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'polyform';
const formatQty = (q: number, unit: string) => (unit === 'no.' ? String(Math.round(q)) : q.toLocaleString(undefined, { maximumFractionDigits: 1 }));
