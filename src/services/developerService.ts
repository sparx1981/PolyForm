import * as THREE from 'three';
import { Shape, CustomLight } from '../types';

export interface SDK {
  createRectangle: (args: { width: number, height: number, position?: [number, number, number] }) => Shape;
  createBox: (args: { width: number, height: number, depth: number, position?: [number, number, number] }) => Shape;
  createSphere: (args: { radius: number, position?: [number, number, number] }) => Shape;
  createCone: (args: { radius: number, height: number, position?: [number, number, number] }) => Shape;
  createPyramid: (args: { radius: number, height: number, position?: [number, number, number] }) => Shape;
  createDonut: (args: { radius: number, tube: number, position?: [number, number, number] }) => Shape;
  createDome: (args: { radius: number, position?: [number, number, number] }) => Shape;
  createPoly: (args: { vertices: [number, number, number][], position?: [number, number, number] }) => Shape;
  pushPull: (shape: Shape, amount: number) => Shape;
  applyColor: (shape: Shape, color: string) => void;
  setTag: (shape: Shape, key: string, value: string) => void;
  getObjectByName: (name: string) => Shape | undefined;
  getSelectedObject: () => Shape | null;
  deleteObject: (id: string) => void;
  saveScene: (name: string) => void;
  setSkybox: (type: any, blur?: number, rotation?: number, intensity?: number) => void;
  setFog: (settings: any) => void;
  addLight: (lightData: any) => void;
  setBevelType: (type: 'radius' | 'chamfer') => void;
  divideSurface: (shapeId: string, faceIndex: number) => void;
  addProjectorLight: (lightData: any) => void;
  performCSG: (targetId: string, cutterId: string, operation: 'SUBTRACTION') => void;
  deformObject: (id: string, settings: { radius: number, strength: number, direction: 'outward' | 'inward' | 'both' }) => void;
  worldView: {
    importMap: (args: { lat: number, lng: number, zoom?: number, altitude?: number, radius?: number }) => void;
    setLocation: (lat: number, lng: number) => void;
    setRadius: (radius: number) => void;
    setZoom: (zoom: number) => void;
    setAltitude: (altitude: number) => void;
  };
  addNote: (text: string, position: [number, number, number]) => void;
  setNoteVisibility: (id: string, visible: boolean) => void;
  toggleAllNotes: (visible: boolean) => void;
  addRectLight: (color: string, intensity: number, position: [number, number, number], scale?: [number, number]) => void;
  animateSun: (cycleSpeed?: number) => void;
  addObject: (type: Shape['type'], props: Partial<Shape>) => Shape;
  toggleFloor: (enabled: boolean) => void;
  toggleGrid: (enabled: boolean) => void;
  setZoom: (zoom: number) => void;
  resetView: (view: 'perspective' | 'plan' | 'front' | 'rear' | 'left' | 'right') => void;
  setCameraDefaults: (position: [number, number, number], target: [number, number, number]) => void;
  focusObject: (id: string) => void;
  getSyncStatus: () => 'synced' | 'syncing' | 'error' | 'offline';
  getCollaborators: () => any[];
  diagLog: (category: string, message: string, values?: Record<string, unknown>) => void;
  setContactFriction: (enabled: boolean) => void;
  generateModel: (prompt: string) => void;
  openWebpage: (url: string) => void;
  log: (message: string) => void;
}

export class DeveloperSDK implements SDK {
  private shapes: Shape[];
  private setShapes: (shapes: Shape[] | ((prev: Shape[]) => Shape[])) => void;
  private updateShapeColor: (id: string, color: string) => void;
  private selectedId: string | null;
  private extraSetters: any;

  public worldView = {
    importMap: (args: { lat: number, lng: number, zoom?: number, altitude?: number, radius?: number }) => {
      if (this.extraSetters.setWorldViewLocation) this.extraSetters.setWorldViewLocation({ lat: args.lat, lng: args.lng });
      if (args.zoom !== undefined && this.extraSetters.setZoom) this.extraSetters.setZoom(args.zoom);
      if (args.altitude !== undefined && this.extraSetters.setWorldViewAltitude) this.extraSetters.setWorldViewAltitude(args.altitude);
      if (args.radius !== undefined && this.extraSetters.setWorldViewRadius) this.extraSetters.setWorldViewRadius(args.radius);
      if (this.extraSetters.setIsWorldViewActive) this.extraSetters.setIsWorldViewActive(true);
      if (this.extraSetters.triggerFocusOnMap) this.extraSetters.triggerFocusOnMap();
    },
    setLocation: (lat: number, lng: number) => {
      if (this.extraSetters.setWorldViewLocation) this.extraSetters.setWorldViewLocation({ lat, lng });
    },
    setRadius: (radius: number) => {
      if (this.extraSetters.setWorldViewRadius) this.extraSetters.setWorldViewRadius(radius);
    },
    setZoom: (zoom: number) => {
      if (this.extraSetters.setZoom) this.extraSetters.setZoom(zoom);
    },
    setAltitude: (altitude: number) => {
      if (this.extraSetters.setWorldViewAltitude) this.extraSetters.setWorldViewAltitude(altitude);
    }
  };

  constructor(
    shapes: Shape[], 
    setShapes: (shapes: Shape[] | ((prev: Shape[]) => Shape[])) => void,
    updateShapeColor: (id: string, color: string) => void,
    selectedId: string | null,
    extraSetters?: any
  ) {
    this.shapes = shapes;
    this.setShapes = setShapes;
    this.updateShapeColor = updateShapeColor;
    this.selectedId = selectedId;
    this.extraSetters = extraSetters || {};
  }

  private _createShape(type: Shape['type'], args: any, position?: [number, number, number]): Shape {
    const id = Math.random().toString(36).substr(2, 9);
    const newShape: Shape = {
      id,
      type,
      position: position || [0, 0, 0],
      args,
      color: '#ffffff'
    };
    this.setShapes(prev => [...prev, newShape]);
    return newShape;
  }

  createRectangle(args: { width: number, height: number, position?: [number, number, number] }): Shape {
    return this._createShape('rect', [args.width, 0.01, args.height], args.position);
  }

  createBox(args: { width: number, height: number, depth: number, position?: [number, number, number] }): Shape {
    return this._createShape('box', [args.width, args.height, args.depth], args.position);
  }

  createSphere(args: { radius: number, position?: [number, number, number] }): Shape {
    return this._createShape('sphere', [args.radius, 32, 32], args.position);
  }

  createCone(args: { radius: number, height: number, position?: [number, number, number] }): Shape {
    return this._createShape('cone', [args.radius, args.height, 32], args.position);
  }

  createPyramid(args: { radius: number, height: number, position?: [number, number, number] }): Shape {
    return this._createShape('pyramid', [args.radius, args.height, 4], args.position);
  }

  createDonut(args: { radius: number, tube: number, position?: [number, number, number] }): Shape {
    return this._createShape('donut', [args.radius, args.tube, 16, 100], args.position);
  }

  createDome(args: { radius: number, position?: [number, number, number] }): Shape {
    return this._createShape('dome', [args.radius, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2], args.position);
  }

  createPoly(args: { vertices: [number, number, number][], position?: [number, number, number] }): Shape {
    // Assuming vertices are already in world space or relative to position
    // Internal poly format uses vertices: [[x,y], ...] projected on plane
    // We'll calculate the plane from first 3 vertices
    if (!args.vertices || args.vertices.length < 3) return null as any;
    
    const v0 = new THREE.Vector3(...args.vertices[0]);
    const v1 = new THREE.Vector3(...args.vertices[1]);
    const v2 = new THREE.Vector3(...args.vertices[2]);
    
    const normal = new THREE.Vector3().crossVectors(
      v1.clone().sub(v0),
      v2.clone().sub(v0)
    ).normalize();
    
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    
    // Project vertices to 2D
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(normal.dot(up)) > 0.99) up.set(0, 0, 1);
    const tangent = new THREE.Vector3().crossVectors(normal, up).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    
    const p2d = args.vertices.map(v => {
      const vec = new THREE.Vector3(...v);
      const diff = vec.clone().sub(v0);
      return [diff.dot(tangent), diff.dot(bitangent)];
    });

    const id = Math.random().toString(36).substr(2, 9);
    const newShape: Shape = {
      id,
      type: 'poly',
      position: [v0.x, v0.y, v0.z],
      quaternion: [quat.x, quat.y, quat.z, quat.w],
      args: { vertices: p2d },
      color: '#ffffff'
    };
    
    this.setShapes(prev => [...prev, newShape]);
    return newShape;
  }

  pushPull(shape: Shape, amount: number): Shape {
    if (!shape) return null as any;
    const newArgs = [...shape.args];
    newArgs[1] = amount;
    const newPos: [number, number, number] = [
      shape.position[0],
      shape.position[1] + amount / 2,
      shape.position[2]
    ];
    
    const updatedShape: Shape = {
      ...shape,
      type: 'box',
      args: newArgs,
      position: newPos
    };

    this.setShapes(prev => prev.map(s => s.id === shape.id ? updatedShape : s));
    return updatedShape;
  }

  applyColor(shape: Shape, color: string): void {
    if (!shape) return;
    this.updateShapeColor(shape.id, color);
  }

  setTag(shape: Shape, key: string, value: string): void {
    if (!shape) return;
    this.setShapes(prev => prev.map(s => {
      if (s.id === shape.id) {
        const tags = s.tags || [];
        const newTag = `${key}:${value}`;
        if (!tags.includes(newTag)) {
          return { ...s, tags: [...tags, newTag] };
        }
      }
      return s;
    }));
  }

  getObjectByName(name: string): Shape | undefined {
    return this.shapes.find(s => s.id === name);
  }

  getSelectedObject(): Shape | null {
    const shape = this.shapes.find(s => s.id === this.selectedId) || null;
    if (!shape) return null;

    // Return a proxy that intercepts property assignments
    return new Proxy(shape, {
      set: (target, prop, value) => {
        if (['position', 'rotation', 'quaternion', 'scale'].includes(prop as string)) {
          this.setShapes(prev => prev.map(s => s.id === target.id ? { ...s, [prop]: value } : s));
          return true;
        }
        (target as any)[prop] = value;
        return true;
      }
    });
  }

  deleteObject(id: string): void {
    this.setShapes(prev => prev.filter(s => s.id !== id));
  }

  saveScene(name: string): void {
    if (this.extraSetters.setScenes) {
      this.extraSetters.setScenes((prev: any) => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        name,
        shapes: [...this.shapes],
        timestamp: new Date().toISOString()
      }]);
    }
  }

  setSkybox(type: any, blur?: number, rotation?: number, intensity?: number): void {
    if (this.extraSetters.setSkybox) this.extraSetters.setSkybox(type);
    if (blur !== undefined && this.extraSetters.setSkyboxBlur) this.extraSetters.setSkyboxBlur(blur);
    if (rotation !== undefined && this.extraSetters.setSkyboxRotation) this.extraSetters.setSkyboxRotation(rotation);
    if (intensity !== undefined && this.extraSetters.setEnvironmentIntensity) this.extraSetters.setEnvironmentIntensity(intensity);
  }

  setFog(settings: any): void {
    if (this.extraSetters.setFogSettings) {
      this.extraSetters.setFogSettings((prev: any) => ({ ...prev, ...settings }));
    }
  }

  addLight(lightData: any): void {
    if (this.extraSetters.setCustomLights) {
      this.extraSetters.setCustomLights((prev: any) => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        ...lightData
      }]);
    }
  }

  setBevelType(type: 'radius' | 'chamfer'): void {
    if (this.extraSetters.setActiveBevelType) this.extraSetters.setActiveBevelType(type);
  }

  setName(obj: Shape, name: string): void {
    if (!obj) return;
    if (this.extraSetters.setShapes) {
      this.extraSetters.setShapes((prev: Shape[]) => prev.map(s => s.id === obj.id ? { ...s, name } : s));
    }
  }

  setBevel(obj: Shape, settings: { amount?: number, type?: 'radius' | 'chamfer', segments?: number }): void {
    if (!obj) return;
    if (this.extraSetters.setShapes) {
      this.extraSetters.setShapes((prev: Shape[]) => prev.map(s => s.id === obj.id ? {
        ...s,
        bevelAmount: settings.amount !== undefined ? settings.amount : s.bevelAmount,
        bevelType: settings.type !== undefined ? settings.type : s.bevelType,
        bevelSegments: settings.segments !== undefined ? settings.segments : s.bevelSegments
      } : s));
    }
  }

  divideSurface(shapeId: string, faceIndex: number, divisions: number | [number, number] = 2): void {
    if (this.extraSetters.setShapes) {
      this.extraSetters.setShapes((prev: Shape[]) => prev.map(s => {
        if (s.id === shapeId) {
          const surfaceDivisions = s.surfaceDivisions || {};
          const otherIdx = faceIndex % 2 === 0 ? faceIndex + 1 : faceIndex - 1;
          return {
            ...s,
            surfaceDivisions: {
              ...surfaceDivisions,
              [faceIndex]: divisions,
              [otherIdx]: divisions
            }
          };
        }
        return s;
      }));
    }
  }

  addProjectorLight(lightData: any): void {
    this.addLight({
      type: 'projector',
      ...lightData
    });
  }

  performCSG(targetId: string, cutterId: string, operation: 'SUBTRACTION'): void {
    window.dispatchEvent(new CustomEvent('request-csg', { detail: { targetId, cutterId, operation } }));
  }

  deformObject(id: string, settings: { radius: number, strength: number, direction: 'outward' | 'inward' | 'both' }): void {
    window.dispatchEvent(new CustomEvent('request-deform', { detail: { id, settings } }));
  }

  setShadows(enabled: boolean): void {
    if (this.extraSetters.setShadowsEnabled) {
      this.extraSetters.setShadowsEnabled(enabled);
    }
  }

  setGrid(enabled: boolean): void {
    if (this.extraSetters.setGridEnabled) {
      this.extraSetters.setGridEnabled(enabled);
    }
  }

  setFloor(enabled: boolean, color?: string): void {
    if (this.extraSetters.setFloorEnabled) {
      this.extraSetters.setFloorEnabled(enabled);
    }
    if (color && this.extraSetters.setFloorColor) {
      this.extraSetters.setFloorColor(color);
    }
  }

  setAmbientOcclusion(enabled: boolean): void {
    if (this.extraSetters.setAmbientOcclusionEnabled) {
      this.extraSetters.setAmbientOcclusionEnabled(enabled);
    }
  }

  setSunSettings(settings: { intensity?: number, position?: [number, number, number], animate?: boolean, speed?: number }): void {
    if (settings.intensity !== undefined && this.extraSetters.setSunIntensity) {
      this.extraSetters.setSunIntensity(settings.intensity);
    }
    if (settings.position !== undefined && this.extraSetters.setLightPosition) {
      this.extraSetters.setLightPosition(settings.position);
    }
    if (settings.animate !== undefined && this.extraSetters.setAnimateSun) {
      this.extraSetters.setAnimateSun(settings.animate);
    }
    if (settings.speed !== undefined && this.extraSetters.setSunSpeed) {
      this.extraSetters.setSunSpeed(settings.speed);
    }
  }

  addNote(text: string, position: [number, number, number]): void {
    if (this.extraSetters.setNotes) {
      this.extraSetters.setNotes((prev: any[]) => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        text,
        position: { x: position[0], y: position[1], z: position[2] },
        authorUid: 'sdk',
        authorName: 'Developer SDK',
        createdAt: Date.now(),
        completed: false
      }]);
    }
  }

  setNoteVisibility(id: string, visible: boolean): void {
    if (this.extraSetters.setNotes) {
      this.extraSetters.setNotes((prev: any[]) => prev.map(n => n.id === id ? { ...n, visible } : n));
    }
  }

  toggleAllNotes(visible: boolean): void {
    if (this.extraSetters.setAllNotesVisible) {
      this.extraSetters.setAllNotesVisible(visible);
    }
  }

  addRectLight(color: string, intensity: number, position: [number, number, number], scale?: [number, number]): void {
    this.addLight({
      type: 'rect',
      color,
      intensity,
      position,
      width: scale ? scale[0] : 5,
      height: scale ? scale[1] : 5
    });
  }

  animateSun(cycleSpeed?: number): void {
    if (this.extraSetters.setAnimateSun) this.extraSetters.setAnimateSun(true);
    if (cycleSpeed !== undefined && this.extraSetters.setSunSpeed) this.extraSetters.setSunSpeed(cycleSpeed);
  }

  addObject(type: Shape['type'], props: Partial<Shape>): Shape {
    const id = Math.random().toString(36).substr(2, 9);
    const newShape: Shape = {
      id,
      type,
      position: props.position || [0, 0, 0],
      args: props.args || (type === 'box' ? [1, 1, 1] : type === 'sphere' ? [1, 32, 32] : [1, 1, 1]),
      color: props.color || '#ffffff',
      ...props
    };
    this.setShapes(prev => [...prev, newShape]);
    return newShape;
  }

  toggleFloor(enabled: boolean): void {
    this.setFloor(enabled);
  }

  toggleGrid(enabled: boolean): void {
    this.setGrid(enabled);
  }

  setZoom(zoom: number): void {
    window.dispatchEvent(new CustomEvent('set-camera', { detail: { zoom } }));
  }

  resetView(view: 'perspective' | 'plan' | 'front' | 'rear' | 'left' | 'right'): void {
    window.dispatchEvent(new CustomEvent('trigger-view-reset', { detail: { view } }));
  }

  setCameraDefaults(position: [number, number, number], target: [number, number, number]): void {
    if (this.extraSetters.setDefaultCameraPosition) this.extraSetters.setDefaultCameraPosition(position);
    if (this.extraSetters.setDefaultCameraTarget) this.extraSetters.setDefaultCameraTarget(target);
  }

  focusObject(id: string): void {
    const mesh = this.shapes.find(s => s.id === id);
    if (mesh) {
      window.dispatchEvent(new CustomEvent('set-camera', { 
        detail: { 
          target: mesh.position,
          position: [mesh.position[0] + 5, mesh.position[1] + 5, mesh.position[2] + 5]
        } 
      }));
    }
  }

  getSyncStatus(): 'synced' | 'syncing' | 'error' | 'offline' {
    return this.extraSetters.syncStatus || 'synced';
  }

  getCollaborators(): any[] {
    return this.extraSetters.collaborators || [];
  }
  
  diagLog(category: string, message: string, values?: Record<string, unknown>): void {
    if (this.extraSetters.diagLog) {
      this.extraSetters.diagLog(category, message, values);
    } else {
      console.log(`[SDK DIAG: ${category}] ${message}`, values);
    }
  }

  setContactFriction(enabled: boolean): void {
    if (this.extraSetters.setContactFrictionEnabled) {
      this.extraSetters.setContactFrictionEnabled(enabled);
    }
  }

  generateModel(prompt: string): void {
    // We can dispatch an event that AIGenerate.tsx listens for, or call the setter
    if (this.extraSetters.setIsAIGenerateOpen) {
      this.extraSetters.setIsAIGenerateOpen(true);
      // Wait a moment for mount then we could theoretically inject prompt if we had a programmatic path
      // For now, opening the UI is a good SDK action
    }
  }

  openWebpage(url: string): void {
    if (this.extraSetters.setEmbeddedWebpageUrl) {
      this.extraSetters.setEmbeddedWebpageUrl(url);
      if (this.extraSetters.diagLog) {
        this.extraSetters.diagLog('SDK', 'Opening embedded webpage', { url });
      }
    }
  }

  log(message: string): void {
    if (this.extraSetters.onLog) {
      this.extraSetters.onLog(message);
    } else {
      console.log(`[SDK LOG] ${message}`);
    }
  }
}
