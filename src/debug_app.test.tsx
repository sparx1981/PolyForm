// @vitest-environment jsdom
import { afterEach, describe, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';

// Without this, the two renders below stay mounted side by side for the rest of the file,
// so a pending async effect (e.g. an asset-catalog fetch) from the first App can still be
// scheduled to update React state after this test file's jsdom environment is torn down.
afterEach(cleanup);

vi.mock('./firebase', () => ({
  db: {},
  auth: { 
    currentUser: { uid: 'user123', email: 'craigtrickett@gmail.com' },
    onAuthStateChanged: vi.fn((auth, cb) => {
      cb({ uid: 'user123', email: 'craigtrickett@gmail.com' });
      return () => {};
    })
  },
  googleProvider: {},
  handleFirestoreError: vi.fn(() => ({ isQuotaError: false, isOfflineError: false, message: 'error' })),
  OperationType: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write',
  },
  isQuotaLocked: () => false,
  cleanFirestoreDataForSave: (obj: any) => obj,
  restoreFirestoreArraysAfterLoad: (obj: any) => obj,
  offloadModelForSave: vi.fn(async (s) => s),
  hydrateOffloadedModel: vi.fn(async (s) => s),
  assertModelFits: vi.fn(),
  ModelTooLargeError: class extends Error {},
  firebaseGeometryIO: {},
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((auth, cb) => {
    cb({ uid: 'user123', email: 'craigtrickett@gmail.com' });
    return () => {};
  }),
  signInWithPopup: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@react-three/drei', () => {
  const comp = ({ children }: any) => <div>{children}</div>;
  return {
    useHelper: vi.fn(),
    useTexture: vi.fn(() => ({})),
    useGLTF: vi.fn(() => ({ scene: {} })),
    useFBX: vi.fn(() => ({})),
    Html: comp,
    GizmoHelper: comp,
    GizmoViewport: comp,
    TransformControls: comp,
    PivotControls: comp,
    Stats: comp,
    Line: comp,
    Text: comp,
    PerspectiveCamera: comp,
    OrthographicCamera: comp,
    OrbitControls: comp,
    Sky: comp,
    Grid: comp,
    Environment: comp,
    Center: comp,
    Billboard: comp,
    Edges: comp,
  };
});

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  doc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(async () => ({ size: 0, docs: [] })),
  or: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  orderBy: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: vi.fn(),
  runTransaction: vi.fn(),
}));

// Mock Three / R3F if needed
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: any) => <div data-testid="r3f-canvas">{children}</div>,
  useFrame: vi.fn(),
  useThree: vi.fn(() => ({
    camera: { position: { x: 0, y: 0, z: 0, set: vi.fn() }, rotation: { x: 0, y: 0, z: 0 }, lookAt: vi.fn() },
    gl: {
      getSize: vi.fn(),
      getPixelRatio: vi.fn(() => 1),
      capabilities: { isWebGL2: true },
      domElement: document.createElement('canvas'),
    },
    scene: {
      backgroundRotation: { set: vi.fn() },
      environmentRotation: { set: vi.fn() },
      add: vi.fn(),
      remove: vi.fn(),
    },
    mouse: { x: 0, y: 0 },
    raycaster: {
      ray: {
        origin: { x: 0, y: 0, z: 0 },
        direction: { x: 0, y: 0, z: 1 }
      }
    },
    size: { width: 800, height: 600 },
    viewport: { dpr: 1 }
  })),
  createPortal: ({ children }: any) => <div>{children}</div>
}));

import App from './App';

describe('App mounting', () => {
  it('renders App without crashing in classic mode', () => {
    localStorage.setItem('polyform_layout_mode', 'classic');
    render(<App />);
  });

  it('renders App without crashing in unified mode', () => {
    localStorage.setItem('polyform_layout_mode', 'unified');
    render(<App />);
  });
});

