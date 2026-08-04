import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Globe, Search, MapPin, Layers, Navigation2, AlertCircle, ExternalLink } from 'lucide-react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import GoogleMapReact from 'google-map-react';

interface MapMarkerProps {
  lat: number;
  lng: number;
  children: React.ReactNode;
  className?: string;
}

const MapMarker = ({ children, className }: MapMarkerProps) => (
  <div className={className}>{children}</div>
);

export default function WorldView() {
  const { 
    isWorldViewOpen, 
    setIsWorldViewOpen, 
    worldViewLocation, 
    setWorldViewLocation, 
    worldViewAltitude, 
    setWorldViewAltitude,
    worldViewRadius,
    setWorldViewRadius,
    isWorldViewActive,
    setIsWorldViewActive,
    theme
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const isKeyMissing = !apiKey || apiKey === '';

  if (!isWorldViewOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      console.log('[WorldView] Searching for:', searchQuery);
      
      // Try to parse as coordinates first (lat, lng)
      const coordRegex = /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/;
      const coordMatch = searchQuery.match(coordRegex);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        setWorldViewLocation({ 
          lat, 
          lng, 
          address: `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}` 
        });
        setIsSearching(false);
        return;
      }

      // Use Google Geocoding API if key is available
      if (apiKey) {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchQuery)}&key=${apiKey}`
        );
        const data = await response.json();
        
        if (data.status === 'OK' && data.results.length > 0) {
          const result = data.results[0];
          const { lat, lng } = result.geometry.location;
          console.log(`[WorldView] Geocoding success: ${result.formatted_address} (${lat}, ${lng})`);
          setWorldViewLocation({ 
            lat, 
            lng, 
            address: result.formatted_address 
          });
          return;
        } else {
          console.warn('[WorldView] Geocoding API returned status:', data.status);
        }
      }

      // Fallback to Nominatim if API fails or key is missing
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await response.json();
        
        if (data && data.length > 0) {
          const result = data[0];
          const lat = parseFloat(result.lat);
          const lng = parseFloat(result.lon);
          console.log(`[WorldView] Nominatim success: ${result.display_name} (${lat}, ${lng})`);
          setWorldViewLocation({ 
            lat, 
            lng, 
            address: result.display_name 
          });
          return;
        }
      } catch (nomErr) {
        console.warn('[WorldView] Nominatim fallback failed:', nomErr);
      }

      // Final fallback if all else fails
      if (searchQuery.toLowerCase().includes('london')) {
        setWorldViewLocation({ lat: 51.5074, lng: -0.1278, address: 'London, UK' });
      } else {
        setWorldViewLocation({ 
          lat: worldViewLocation.lat,
          lng: worldViewLocation.lng,
          address: `Point: ${worldViewLocation.lat.toFixed(4)}, ${worldViewLocation.lng.toFixed(4)}`
        });
      }
    } catch (err) {
      console.error('[WorldView] Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          drag
          dragMomentum={false}
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className={cn(
            "w-full max-w-4xl h-[600px] rounded-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto border",
            theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"
          )}
        >
          {/* Header */}
          <div className="h-14 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6 bg-gray-50 dark:bg-gray-800/50 cursor-move">
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 text-trimble-blue" />
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">WorldView Geolocation</h2>
            </div>
            <button 
              onClick={() => setIsWorldViewOpen(false)}
              className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>

          <div className="flex-1 flex relative">
            {/* Sidebar Controls */}
            <div className={cn(
              "w-72 border-r p-4 flex flex-col gap-6",
              theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"
            )}>
              {/* Search */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Location</label>
                {isKeyMissing && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl mb-4">
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-1">
                      <AlertCircle size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">API Key Required</span>
                    </div>
                    <p className="text-[10px] text-amber-700 dark:text-amber-500 leading-normal">
                      Google Maps API Key is missing. The 3D overlay will not load until a valid key is added to the Secrets panel.
                    </p>
                    <a 
                      href="https://console.cloud.google.com/google/maps-apis/credentials" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="mt-2 text-[10px] text-trimble-blue hover:underline flex items-center gap-1"
                    >
                      Get an API Key <ExternalLink size={10} />
                    </a>
                  </div>
                )}
                <form onSubmit={handleSearch} className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search address or coordinates..."
                    className={cn(
                      "w-full pl-9 pr-3 py-2 rounded-xl text-sm border focus:ring-2 focus:ring-trimble-blue outline-none transition-all",
                      theme === 'dark' ? "bg-gray-800 border-gray-700 text-white" : "bg-white border-gray-200 text-gray-900"
                    )}
                  />
                  <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                  {isSearching && (
                    <div className="absolute right-3 top-2.5">
                      <div className="w-4 h-4 border-2 border-trimble-blue border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </form>
                {worldViewLocation.address && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-trimble-blue/5 border border-trimble-blue/10">
                    <MapPin size={14} className="text-trimble-blue mt-0.5 shrink-0" />
                    <span className="text-xs text-gray-600 dark:text-gray-400 leading-tight">
                      {worldViewLocation.address}
                    </span>
                  </div>
                )}
              </div>

              {/* Altitude Control */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Altitude Offset (m)</label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="-100"
                    max="1000"
                    step="0.1"
                    value={worldViewAltitude}
                    onChange={(e) => setWorldViewAltitude(parseFloat(e.target.value) || 0)}
                    className={cn(
                      "w-24 px-3 py-1.5 rounded-lg border text-sm font-mono focus:ring-2 focus:ring-trimble-blue outline-none",
                      theme === 'dark' ? "bg-gray-800 border-gray-700 text-white" : "bg-white border-gray-200 text-gray-900"
                    )}
                  />
                  <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
                  <button 
                    onClick={() => setWorldViewAltitude(1)}
                    className="text-[10px] text-trimble-blue hover:underline"
                  >
                    Reset to 1m
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 italic leading-tight">
                  Height above/below the ground level in your 3D workspace.
                </p>
              </div>

              {/* Coverage Slider */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Map Coverage</label>
                  <span className="text-xs font-mono text-trimble-blue bg-trimble-blue/10 px-1.5 py-0.5 rounded">
                    {worldViewRadius}m
                  </span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="450"
                  step="10"
                  value={worldViewRadius}
                  onChange={(e) => setWorldViewRadius(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                />
                <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                  <span>50m</span>
                  <span>100m (Default)</span>
                  <span>450m (Max)</span>
                </div>
              </div>

              {/* Status Toggle */}
              <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => {
                    const nextActive = !isWorldViewActive;
                    setIsWorldViewActive(nextActive);
                    console.log(`[WorldView] Overlay ${nextActive ? 'activated' : 'deactivated'} at Lat: ${worldViewLocation.lat}, Lng: ${worldViewLocation.lng}, Alt: ${worldViewAltitude}m`);
                  }}
                  className={cn(
                    "w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg",
                    isWorldViewActive 
                      ? "bg-red-500 hover:bg-red-600 text-white shadow-red-500/20" 
                      : "bg-trimble-blue hover:bg-trimble-blue/90 text-white shadow-trimble-blue/20"
                  )}
                >
                  <Layers size={18} />
                  {isWorldViewActive ? 'Deactivate Overlay' : 'Activate Map Overlay'}
                </button>
                <p className="text-[10px] text-gray-400 mt-3 text-center leading-relaxed">
                  Activating WorldView will render a 2D map plane beneath your 3D models at the specified altitude.
                </p>
              </div>
            </div>

            {/* Map Area */}
            <div className="flex-1 bg-gray-100 dark:bg-gray-950 relative overflow-hidden">
              <GoogleMapReact
                bootstrapURLKeys={{ key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '' }}
                center={{ lat: worldViewLocation.lat, lng: worldViewLocation.lng }}
                zoom={18}
                options={{
                  styles: theme === 'dark' ? darkMapStyles : [],
                  disableDefaultUI: true,
                  zoomControl: true,
                  mapTypeId: 'satellite',
                  tilt: 0
                }}
                onChange={({ center }) => setWorldViewLocation({ ...worldViewLocation, lat: center.lat, lng: center.lng })}
              >
                <MapMarker
                  lat={worldViewLocation.lat}
                  lng={worldViewLocation.lng}
                  className="relative flex items-center justify-center"
                >
                  <div className="absolute w-32 h-32 bg-trimble-blue/20 rounded-full animate-pulse border border-trimble-blue/40" />
                  <div className="relative bg-white dark:bg-gray-800 p-1.5 rounded-full shadow-lg border-2 border-trimble-blue">
                    <Navigation2 size={20} className="text-trimble-blue fill-trimble-blue" />
                  </div>
                </MapMarker>
              </GoogleMapReact>

              {/* Map Info Overlay */}
              <div className="absolute bottom-4 right-4 flex flex-col gap-2 items-end">
                <div className="bg-black/60 backdrop-blur-md text-white px-3 py-1.5 rounded-lg text-[10px] font-mono border border-white/10 shadow-xl">
                  LAT: {worldViewLocation.lat.toFixed(6)}<br />
                  LNG: {worldViewLocation.lng.toFixed(6)}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
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
