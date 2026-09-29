import React, { useState } from 'react';
import { Search, MapPin, Layers, Navigation2, AlertCircle, ExternalLink, ChevronDown, ChevronRight, Lock, Mountain, SlidersHorizontal } from 'lucide-react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import GoogleMapReact from 'google-map-react';
import { findPlace } from '../lib/worldSite/fetchSite';
import { findSiteGround } from '../lib/worldSite/site';
import { worldViewUnlocked } from '../lib/worldViewPanel';
import { WorldSiteSection, GoogleStatusLine, NudgeSlider } from './WorldSiteControls';

/**
 * WorldView's tool modifier panel: choose a place, then position the map, import its 3D site or
 * switch the flat map overlay on. Everything is in collapsible sections; until an address or
 * postcode has been found only the address section can be used.
 */

interface MapMarkerProps {
  lat: number;
  lng: number;
  children: React.ReactNode;
  className?: string;
}

const MapMarker = ({ children, className }: MapMarkerProps) => (
  <div className={className}>{children}</div>
);

/** A collapsible section; locked ones can't be opened. */
function Section({ title, icon, open, locked, lockedHint, onToggle, children }: {
  title: string;
  icon: React.ReactNode;
  open: boolean;
  locked: boolean;
  lockedHint: string;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden', locked && 'opacity-50')}>
      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        aria-expanded={open && !locked}
        title={locked ? lockedHint : undefined}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-left bg-gray-50 dark:bg-gray-800/60 transition-colors',
          locked ? 'cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-800',
        )}
      >
        <span className="text-polyform-blue shrink-0">{icon}</span>
        <span className="flex-1 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">{title}</span>
        {locked ? <Lock size={12} className="text-gray-400" /> : open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
      </button>
      {open && !locked && <div className="p-3 space-y-3">{children}</div>}
    </div>
  );
}

export default function WorldViewPanel() {
  const {
    worldViewLocation,
    setWorldViewLocation,
    worldViewAltitude,
    setWorldViewAltitude,
    worldViewRadius,
    setWorldViewRadius,
    isWorldViewActive,
    setIsWorldViewActive,
    googleMapsApiKey,
    worldViewGoogle,
    setWorldViewGoogle,
    worldViewGoogleNudge,
    setWorldViewGoogleNudge,
    shapes,
    theme,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  // Only the address section starts open; the rest wait for a place.
  const [open, setOpen] = useState<Record<string, boolean>>({ location: true });
  const apiKey = googleMapsApiKey || '';
  const isKeyMissing = !apiKey;

  const hasImportedSite = !!findSiteGround(shapes)?.terrainData?.site;
  // With Google switched on for the imported site (3D Site > Look), that one is used instead.
  const siteGoogleOn = !!findSiteGround(shapes)?.terrainData?.site?.googleContext;
  const unlocked = worldViewUnlocked({ address: worldViewLocation.address, overlayActive: isWorldViewActive, hasImportedSite });
  const toggle = (id: string) => setOpen(prev => ({ ...prev, [id]: !prev[id] }));
  const lockedHint = 'Enter an address or postcode first';

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchError('');
    try {
      // Coordinates as typed, a UK postcode, or any address (Google when there's a key, else OpenStreetMap).
      const place = await findPlace(searchQuery, apiKey);
      if (place) setWorldViewLocation({ lat: place.lat, lng: place.lng, address: place.address });
      else setSearchError(`Couldn't find "${searchQuery}". Try a fuller address, a postcode, or "lat, lng".`);
    } catch (err) {
      console.error('[WorldView] Search error:', err);
      setSearchError('The search failed. Check your connection and try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const input = cn(
    'px-3 py-1.5 rounded-lg border text-sm focus:ring-2 focus:ring-polyform-blue outline-none',
    theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900',
  );

  return (
    <div className="space-y-2">
      {/* Location: the address box, with a small map below it once there is a place */}
      <Section title="Location" icon={<MapPin size={14} />} open={!!open.location} locked={false} lockedHint="" onToggle={() => toggle('location')}>
        {isKeyMissing && (
          <div className="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg">
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 mb-1">
              <AlertCircle size={12} />
              <span className="text-[10px] font-bold uppercase tracking-wider">API Key Required</span>
            </div>
            <p className="text-[10px] text-amber-700 dark:text-amber-500 leading-normal">
              Google Maps API Key is missing. The 3D overlay will not load until a valid key is added to the Secrets panel.
            </p>
            <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener noreferrer"
              className="mt-1.5 text-[10px] text-polyform-blue hover:underline flex items-center gap-1">
              Get an API Key <ExternalLink size={10} />
            </a>
          </div>
        )}

        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Address, postcode or lat, lng"
            aria-label="Address, postcode or coordinates"
            className={cn(input, 'w-full pl-8 pr-3')}
          />
          <Search className="absolute left-2.5 top-2.5 text-gray-400" size={14} />
          {isSearching && (
            <div className="absolute right-3 top-2.5">
              <div className="w-4 h-4 border-2 border-polyform-blue border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </form>
        {searchError && <p className="text-[10px] text-red-500 leading-tight">{searchError}</p>}
        {!unlocked && !searchError && (
          <p className="text-[10px] text-gray-400 leading-tight">Enter an address or postcode and press Enter. The other sections open once the place is found.</p>
        )}

        {unlocked && (
          <>
            {worldViewLocation.address && (
              <div className="flex items-start gap-2 p-2 rounded-lg bg-polyform-blue/5 border border-polyform-blue/10">
                <MapPin size={12} className="text-polyform-blue mt-0.5 shrink-0" />
                <span className="text-[11px] text-gray-600 dark:text-gray-400 leading-tight">{worldViewLocation.address}</span>
              </div>
            )}

            {/* The map preview */}
            <div className="relative h-44 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-700">
              <GoogleMapReact
                  bootstrapURLKeys={{ key: apiKey }}
                  center={{ lat: worldViewLocation.lat, lng: worldViewLocation.lng }}
                  zoom={18}
                  options={{
                    styles: theme === 'dark' ? darkMapStyles : [],
                    disableDefaultUI: true,
                    zoomControl: true,
                    mapTypeId: 'satellite',
                    tilt: 0,
                  }}
                  onChange={({ center }) => setWorldViewLocation({ ...worldViewLocation, lat: center.lat, lng: center.lng })}
                >
                  <MapMarker lat={worldViewLocation.lat} lng={worldViewLocation.lng} className="relative flex items-center justify-center">
                    <div className="absolute w-16 h-16 bg-polyform-blue/20 rounded-full animate-pulse border border-polyform-blue/40" />
                    <div className="relative bg-white dark:bg-gray-800 p-1 rounded-full shadow-lg border-2 border-polyform-blue">
                      <Navigation2 size={14} className="text-polyform-blue fill-polyform-blue" />
                    </div>
                  </MapMarker>
                </GoogleMapReact>
              <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur-md text-white px-2 py-1 rounded text-[9px] font-mono border border-white/10 pointer-events-none">
                {worldViewLocation.lat.toFixed(5)}, {worldViewLocation.lng.toFixed(5)}
              </div>
            </div>
          </>
        )}
      </Section>

      {/* Height above the ground, how much map, and the flat map picture under the model */}
      <Section title="Site position" icon={<SlidersHorizontal size={14} />} open={!!open.position} locked={!unlocked} lockedHint={lockedHint} onToggle={() => toggle('position')}>
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Altitude Offset (m)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="-100"
              max="1000"
              step="0.1"
              value={worldViewAltitude}
              onChange={(e) => setWorldViewAltitude(parseFloat(e.target.value) || 0)}
              className={cn(input, 'w-24 font-mono')}
            />
            <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
            <button onClick={() => setWorldViewAltitude(1)} className="text-[10px] text-polyform-blue hover:underline">Reset to 1m</button>
          </div>
          <p className="text-[10px] text-gray-400 italic leading-tight">Height above/below the ground level in your 3D workspace.</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Map Coverage</label>
            <span className="text-xs font-mono text-polyform-blue bg-polyform-blue/10 px-1.5 py-0.5 rounded">{worldViewRadius}m</span>
          </div>
          <input
            type="range"
            min="50"
            max="450"
            step="10"
            value={worldViewRadius}
            onChange={(e) => setWorldViewRadius(parseInt(e.target.value))}
            className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-polyform-blue"
          />
          <div className="flex justify-between text-[10px] text-gray-400 font-mono">
            <span>50m</span>
            <span>100m (Default)</span>
            <span>450m (Max)</span>
          </div>
        </div>
        <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={() => {
              const nextActive = !isWorldViewActive;
              setIsWorldViewActive(nextActive);
              console.log(`[WorldView] Overlay ${nextActive ? 'activated' : 'deactivated'} at Lat: ${worldViewLocation.lat}, Lng: ${worldViewLocation.lng}, Alt: ${worldViewAltitude}m`);
            }}
            className={cn(
              'w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg',
              isWorldViewActive
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20'
                : 'bg-polyform-blue hover:bg-polyform-blue/90 text-white shadow-polyform-blue/20',
            )}
          >
            <Layers size={16} />
            {isWorldViewActive ? 'Deactivate Overlay' : 'Activate Map Overlay'}
          </button>
          <p className="text-[10px] text-gray-400 text-center leading-relaxed">
            Activating WorldView will render a 2D map plane beneath your 3D models at the specified altitude.
          </p>
        </div>
        {isWorldViewActive && !siteGoogleOn && (
          <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={worldViewGoogle} disabled={isKeyMissing}
                onChange={e => setWorldViewGoogle(e.target.checked)} />
              <span>Photorealistic surroundings</span>
            </label>
            {worldViewGoogle && !isKeyMissing && (
              <div className="space-y-2 pl-6">
                <GoogleStatusLine />
                <NudgeSlider value={worldViewGoogleNudge} onCommit={setWorldViewGoogleNudge} />
              </div>
            )}
          </div>
        )}
      </Section>

      {/* The real ground and buildings around the place */}
      <Section title="3D Site" icon={<Mountain size={14} />} open={!!open.site} locked={!unlocked} lockedHint={lockedHint} onToggle={() => toggle('site')}>
        <WorldSiteSection hideTitle />
      </Section>
    </div>
  );
}

const darkMapStyles = [
  { "elementType": "geometry", "stylers": [{ "color": "#242f3e" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#242f3e" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#746855" }] },
  {
    "featureType": "administrative.locality",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#d59563" }]
  },
  {
    "featureType": "poi",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#d59563" }]
  },
  {
    "featureType": "poi.park",
    "elementType": "geometry",
    "stylers": [{ "color": "#263c3f" }]
  },
  {
    "featureType": "poi.park",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#6b9a76" }]
  },
  {
    "featureType": "road",
    "elementType": "geometry",
    "stylers": [{ "color": "#38414e" }]
  },
  {
    "featureType": "road",
    "elementType": "geometry.stroke",
    "stylers": [{ "color": "#212a37" }]
  },
  {
    "featureType": "road",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#9ca5b3" }]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry",
    "stylers": [{ "color": "#746855" }]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry.stroke",
    "stylers": [{ "color": "#1f2835" }]
  },
  {
    "featureType": "road.highway",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#f3d19c" }]
  },
  {
    "featureType": "transit",
    "elementType": "geometry",
    "stylers": [{ "color": "#2f3948" }]
  },
  {
    "featureType": "transit.station",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#d59563" }]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [{ "color": "#17263c" }]
  },
  {
    "featureType": "water",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#515c6d" }]
  },
  {
    "featureType": "water",
    "elementType": "labels.text.stroke",
    "stylers": [{ "color": "#17263c" }]
  }
];
