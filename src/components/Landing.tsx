import React, { Suspense, lazy, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight, Box, Cloud, Footprints, HardDrive, Home, Building2, Leaf, LogIn, Ruler, Smartphone, Sparkles, SunMedium, Users,
} from 'lucide-react';
import Login from './Login';

const LandingHero3D = lazy(() => import('./LandingHero3D'));

const FEATURES: { icon: React.ReactNode; title: string; text: string }[] = [
  { icon: <Home size={20} />, title: 'Architecture', text: 'Walls, rooms and floors, doors and windows that cut their own openings, stairs, and roofs that fit any footprint.' },
  { icon: <Leaf size={20} />, title: 'Gardens and landscape', text: 'Shape the terrain, lay grass and paths, plant trees and flowers, and add fences, patios, decks and ponds.' },
  { icon: <SunMedium size={20} />, title: 'Light, weather and materials', text: 'Real sunlight and shadows, rain and snow, and realistic materials for brick, timber, stone and glass.' },
  { icon: <Ruler size={20} />, title: 'Measure and plan', text: 'Tape measure, protractor, plan and elevation views, and a split view to see two angles at once.' },
  { icon: <Footprints size={20} />, title: 'Walk through it', text: 'Step inside at eye level and walk from room to room, or orbit the whole design.' },
  { icon: <Smartphone size={20} />, title: 'Anywhere', text: 'Runs in the browser on a desktop, tablet or phone. Nothing to install.' },
];

const STORAGE: { icon: React.ReactNode; title: string; text: string }[] = [
  { icon: <Cloud size={18} />, title: 'PolyForm cloud', text: 'Live collaboration: invite people and design together.' },
  { icon: <HardDrive size={18} />, title: 'Google Drive', text: 'Keep large projects as files in your own Drive.' },
  { icon: <Building2 size={18} />, title: 'Trimble Connect', text: 'Store designs alongside the rest of your project.' },
];

function Logo() {
  return (
    <span className="flex items-center gap-2 font-bold text-trimble-dark-blue text-lg tracking-tight">
      <span className="w-8 h-8 rounded-lg bg-trimble-blue text-white flex items-center justify-center shadow-sm"><Box size={18} /></span>
      PolyForm
    </span>
  );
}

/** The first page for visitors who aren't signed in. Everything else sits behind "Login Now". */
export default function Landing() {
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    document.title = 'PolyForm · 3D design for buildings and gardens';
  }, []);

  const loginButton = (label: string, big = false) => (
    <button
      type="button"
      onClick={() => setLoginOpen(true)}
      className={
        'inline-flex items-center justify-center gap-2 rounded-lg bg-trimble-blue text-white font-semibold shadow-md shadow-trimble-blue/20 hover:bg-trimble-dark-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-trimble-blue transition-colors '
        + (big ? 'px-6 py-3 text-base' : 'px-4 py-2 text-sm')
      }
    >
      <LogIn size={big ? 18 : 16} /> {label}
    </button>
  );

  return (
    <div id="landing-page" className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-white text-trimble-gray">
      <header className="sticky top-0 z-20 bg-white/85 backdrop-blur border-b border-gray-100">
        <nav className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4" aria-label="Main">
          <Logo />
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600">
            <a href="#features" className="hover:text-trimble-blue">Features</a>
            <a href="#claude" className="hover:text-trimble-blue">Build with Claude</a>
            <a href="#storage" className="hover:text-trimble-blue">Storage</a>
          </div>
          {loginButton('Login Now')}
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-16 lg:pt-20 lg:pb-24 grid lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-14 items-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p className="text-sm font-semibold text-trimble-blue uppercase tracking-wider mb-4">3D design in your browser</p>
            <h1 className="text-4xl sm:text-5xl font-bold leading-[1.1] text-trimble-dark-blue">
              Design the house.<br />Plant the garden.<br />Walk right in.
            </h1>
            <p className="mt-6 text-lg text-gray-600 max-w-xl">
              PolyForm is a 3D modelling app for buildings and the ground around them. Draw rooms, raise the roof,
              shape the plot and furnish the garden, then see it in real light and walk through it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {loginButton('Login Now', true)}
              <a href="#features" className="inline-flex items-center gap-1.5 text-sm font-semibold text-trimble-blue hover:underline">
                See what it does <ArrowRight size={16} />
              </a>
            </div>
            <p className="mt-4 text-sm text-gray-500">Free to try with a Google account or email.</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden border border-gray-200 shadow-modus-3 bg-gradient-to-b from-sky-100 to-emerald-50"
          >
            <Suspense fallback={null}>
              <LandingHero3D />
            </Suspense>
          </motion.div>
        </section>

        {/* Features */}
        <section id="features" className="bg-gray-light scroll-mt-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
            <h2 className="text-3xl font-bold text-trimble-dark-blue">Everything from foundations to flower beds</h2>
            <p className="mt-3 text-gray-600 max-w-2xl">One model for the building and its site, so the patio meets the back door and the ground meets the floor.</p>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {FEATURES.map(f => (
                <div key={f.title} className="bg-white rounded-xl p-6 border border-gray-100 shadow-modus-1">
                  <div className="w-10 h-10 rounded-lg bg-trimble-blue/10 text-trimble-blue flex items-center justify-center">{f.icon}</div>
                  <h3 className="mt-4 font-semibold text-trimble-dark-blue">{f.title}</h3>
                  <p className="mt-2 text-sm text-gray-600 leading-relaxed">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Claude */}
        <section id="claude" className="scroll-mt-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24 grid lg:grid-cols-2 gap-10 items-center">
            <div>
              <p className="text-sm font-semibold text-trimble-blue uppercase tracking-wider mb-3 flex items-center gap-2"><Sparkles size={16} /> Build with Claude</p>
              <h2 className="text-3xl font-bold text-trimble-dark-blue">Describe it, and Claude builds it</h2>
              <p className="mt-4 text-gray-600">
                Connect PolyForm to Claude and ask for a design in plain words. Claude builds it in your account,
                then shows you a 3D view and a floor plan of every level, so you can check the result before you open PolyForm.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-gray-700">
                <li className="flex gap-2"><span className="text-trimble-blue">•</span> Rooms, roofs, stairs, doors and windows</li>
                <li className="flex gap-2"><span className="text-trimble-blue">•</span> Terrain, planting, fences, patios and ponds</li>
                <li className="flex gap-2"><span className="text-trimble-blue">•</span> Every change can be undone</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white shadow-modus-2 p-5 space-y-4" aria-hidden="true">
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-trimble-blue text-white text-sm px-4 py-3">
                Build me an L-shaped house, two storeys, with four bedrooms and a bathroom upstairs.
              </div>
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-gray-100 text-sm text-gray-800 px-4 py-3">
                Done. Here is the 3D view and the plans for both floors: kitchen, lounge, hallway and WC downstairs; four bedrooms and a bathroom upstairs.
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[1, 2].map(level => (
                  <div key={level} className="rounded-lg border border-gray-200 bg-[#fbfaf7] p-3">
                    <svg viewBox="0 0 100 80" className="w-full">
                      <path d="M8 8 H92 V44 H52 V72 H8 Z" fill="#f5f1e8" stroke="#1f2937" strokeWidth="3" />
                      <path d={level === 1 ? 'M50 8 V44 M8 44 H52' : 'M36 8 V44 M64 8 V44 M8 44 H52 M30 44 V72'} stroke="#1f2937" strokeWidth="2" fill="none" />
                    </svg>
                    <p className="mt-1 text-[11px] font-semibold text-gray-600">Level {level}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Storage and collaboration */}
        <section id="storage" className="bg-gray-light scroll-mt-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
            <h2 className="text-3xl font-bold text-trimble-dark-blue flex items-center gap-3"><Users size={26} className="text-trimble-blue" /> Keep designs where you work</h2>
            <p className="mt-3 text-gray-600 max-w-2xl">Choose where each model lives. Every model appears in one list, wherever it is stored.</p>
            <div className="mt-10 grid md:grid-cols-3 gap-5">
              {STORAGE.map(s => (
                <div key={s.title} className="bg-white rounded-xl p-6 border border-gray-100 shadow-modus-1">
                  <div className="flex items-center gap-2 font-semibold text-trimble-dark-blue"><span className="text-trimble-blue">{s.icon}</span>{s.title}</div>
                  <p className="mt-2 text-sm text-gray-600">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="bg-trimble-dark-blue text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h2 className="text-3xl font-bold">Start your first design</h2>
              <p className="mt-2 text-white/75">Sign in and you’re straight into the modeller.</p>
            </div>
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white text-trimble-dark-blue font-semibold px-6 py-3 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-trimble-dark-blue"
            >
              <LogIn size={18} /> Login Now
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-500">
          <Logo />
          <p>© {new Date().getFullYear()} PolyForm</p>
        </div>
      </footer>

      {loginOpen && <Login onClose={() => setLoginOpen(false)} />}
    </div>
  );
}
