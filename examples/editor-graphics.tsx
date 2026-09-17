import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../src/AppContext';
import Viewport from '../src/components/Viewport';
import RightPanelStack from '../src/components/RightPanelStack';
import { VegetationControls } from '../src/components/graphics/VegetationControls';
import { WeatherControls } from '../src/components/graphics/WeatherControls';
import { SurfaceDepthControls } from '../src/components/graphics/SurfaceDepthControls';
import type { Shape } from '../src/types';
import '../src/index.css';

// Development-only fixture: real provider/viewport/controls, no signed-in user or cloud writes.
function Fixture() {
  const { shapes, setShapes, selectedId, setSelectedId, setSelectedIds, graphicsSettings } = useApp();
  useEffect(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#222'; context.fillRect(0, 0, 64, 64);
    context.fillStyle = '#eee'; for (let y = 0; y < 64; y += 16) for (let x = 0; x < 64; x += 16) context.fillRect(x+2, y+2, 12, 12);
    const plants: Shape[] = Array.from({ length: 64 }, (_, i) => ({ id: `plant-${i}`, type: 'tree', plantSpeciesId: 'norway_spruce',
      position: [(i%8)*5-20, 0, -8-Math.floor(i/8)*5], scale: [0.6,0.6,0.6], args: [], color: '#244c38' }));
    setShapes([...plants, { id: 'depth-tile', name: 'Depth test tile', type: 'box', position: [0,0.5,2], args: [6,1,6], color: '#c88958',
      displacementMapUrl: canvas.toDataURL(), surfaceDepthEnabled: true, surfaceDepthSegments: 16, displacementScale: 0.1, displacementBias: -0.05 }]);
    setSelectedId('depth-tile'); setSelectedIds(['depth-tile']);
  }, []);
  return <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
    <aside className="bg-white text-gray-800 border-r p-3 space-y-4 overflow-auto" style={{ width: 300, flexShrink: 0 }}>
      <h1 className="font-bold">Editor integration verification</h1><WeatherControls /><VegetationControls /><SurfaceDepthControls />
      <button onClick={() => { setSelectedId('plant-0'); setSelectedIds(['plant-0']); }}>Select first plant</button>
      <button onClick={() => { setSelectedId(null); setSelectedIds([]); }}>Clear selection</button>
      <button onClick={() => setShapes(previous => previous.filter(shape => shape.id !== selectedId))}>Delete selected</button>
      <output className="block" data-testid="fixture-status">{shapes.length} shapes · selected {selectedId || 'none'} · clouds {graphicsSettings.weather.cloudsMode}</output>
    </aside>
    <main style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}><Viewport /></main>
    <RightPanelStack />
  </div>;
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<AppProvider><Fixture /></AppProvider>);
