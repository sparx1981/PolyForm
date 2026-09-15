// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useApp } from './AppContext';
import type { Shape } from './types';

// AppProvider talks to Firestore on mount (script/material fetch effects,
// model-sync listeners) and to firebase.ts's own module-level
// initializeApp()/testConnection() side effects. None of that is under
// test here — these mocks keep the provider's render-time effects inert
// so tests exercise its own state/reducer logic, not a real backend.
vi.mock('./firebase', () => ({
  db: {},
  auth: { currentUser: null },
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
}));

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
  getDoc: vi.fn(async () => ({ exists: () => false })),
  orderBy: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: vi.fn(),
  runTransaction: vi.fn(),
}));

function makeShape(overrides: Partial<Shape> = {}): Shape {
  return {
    id: `shape-${Math.random().toString(36).slice(2)}`,
    name: 'Box',
    type: 'box',
    position: [0, 0, 0],
    args: [1, 1, 1],
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0,
    opacity: 1,
    ...overrides,
  } as Shape;
}

function renderApp() {
  return renderHook(() => useApp(), { wrapper: AppProvider });
}

beforeEach(() => {
  localStorage.clear();
});

describe('AppContext / useApp', () => {
  it('throws when used outside of AppProvider', () => {
    // useApp() throws synchronously during render (not at call time), so
    // the throw surfaces from renderHook() itself.
    expect(() => renderHook(() => useApp())).toThrow(/useApp must be used within AppProvider/);
  });

  it('provides sane defaults on initial render', () => {
    const { result } = renderApp();
    expect(result.current.activeTool).toBe('select');
    expect(result.current.shapes).toEqual([]);
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.syncStatus).toBe('unsaved');
  });

  describe('shape mutation & undo/redo', () => {
    it('addShape appends to shapes and records history', () => {
      const { result } = renderApp();
      const shape = makeShape();

      act(() => {
        result.current.addShape(shape);
      });

      expect(result.current.shapes).toHaveLength(1);
      expect(result.current.shapes[0].id).toBe(shape.id);
    });

    it('removeShape drops the shape and clears it from selection', () => {
      const { result } = renderApp();
      const shape = makeShape();

      act(() => {
        result.current.addShape(shape);
        result.current.setSelectedId(shape.id);
        result.current.setSelectedIds([shape.id]);
      });

      act(() => {
        result.current.removeShape(shape.id);
      });

      expect(result.current.shapes).toHaveLength(0);
      expect(result.current.selectedId).toBeNull();
      expect(result.current.selectedIds).toEqual([]);
    });

    it('undo/redo navigate the history stack without truncating it', () => {
      const { result } = renderApp();
      const a = makeShape({ id: 'a' });
      const b = makeShape({ id: 'b' });

      act(() => {
        result.current.addShape(a);
      });
      act(() => {
        result.current.addShape(b);
      });
      expect(result.current.shapes.map(s => s.id)).toEqual(['a', 'b']);

      act(() => {
        result.current.undo();
      });
      expect(result.current.shapes.map(s => s.id)).toEqual(['a']);

      act(() => {
        result.current.redo();
      });
      expect(result.current.shapes.map(s => s.id)).toEqual(['a', 'b']);
    });

    it('undo is a no-op once the oldest history entry is reached', () => {
      const { result } = renderApp();
      act(() => {
        result.current.addShape(makeShape({ id: 'a' }));
      });
      act(() => {
        result.current.addShape(makeShape({ id: 'b' }));
      });
      act(() => {
        result.current.undo(); // back to ['a'], the oldest entry
      });
      act(() => {
        // Already at the oldest entry; a second undo must not throw or
        // move further back.
        result.current.undo();
      });
      expect(result.current.shapes.map(s => s.id)).toEqual(['a']);
    });

    it('redo is a no-op at the head of history', () => {
      const { result } = renderApp();
      act(() => {
        result.current.addShape(makeShape({ id: 'a' }));
      });
      act(() => {
        result.current.redo();
      });
      expect(result.current.shapes.map(s => s.id)).toEqual(['a']);
    });

    it('duplicateObject offsets the copy, names it, and selects it', () => {
      const { result } = renderApp();
      const shape = makeShape({ id: 'orig', name: 'Box', position: [1, 2, 3] });

      act(() => {
        result.current.addShape(shape);
      });
      act(() => {
        result.current.duplicateObject('orig');
      });

      expect(result.current.shapes).toHaveLength(2);
      const copy = result.current.shapes.find(s => s.id !== 'orig')!;
      expect(copy).toBeDefined();
      expect(copy.name).toBe('Box (Copy)');
      expect(copy.position).toEqual([2, 2, 4]);
      expect(result.current.selectedId).toBe(copy.id);
    });

    it('duplicateObject is a no-op for an id that does not exist', () => {
      const { result } = renderApp();
      act(() => {
        result.current.duplicateObject('missing');
      });
      expect(result.current.shapes).toEqual([]);
    });

    it('duplicateMultiple duplicates every matching shape and selects the copies', () => {
      const { result } = renderApp();
      const a = makeShape({ id: 'a', position: [0, 0, 0] });
      const b = makeShape({ id: 'b', position: [5, 0, 0] });

      act(() => {
        result.current.addShape(a);
      });
      act(() => {
        result.current.addShape(b);
      });
      act(() => {
        result.current.duplicateMultiple(['a', 'b', 'missing']);
      });

      expect(result.current.shapes).toHaveLength(4);
      expect(result.current.selectedIds).toHaveLength(2);
    });

    it('clearShapes resets shapes, selection, and history together', () => {
      const { result } = renderApp();
      act(() => {
        result.current.addShape(makeShape({ id: 'a' }));
        result.current.setSelectedId('a');
      });
      act(() => {
        result.current.clearShapes();
      });
      expect(result.current.shapes).toEqual([]);
      expect(result.current.selectedId).toBeNull();
      expect(result.current.currentModelId).toBeNull();
    });
  });

  describe('persisted UI toggles (localStorage-backed)', () => {
    it('isBasicToolbarEnabled defaults to true and persists writes', () => {
      const { result } = renderApp();
      expect(result.current.isBasicToolbarEnabled).toBe(true);

      act(() => {
        result.current.setIsBasicToolbarEnabled(false);
      });
      expect(result.current.isBasicToolbarEnabled).toBe(false);
      expect(localStorage.getItem('polyform_basic_toolbar')).toBe('false');
    });

    it('reads isArchitectureToolbarEnabled from localStorage on mount', () => {
      localStorage.setItem('polyform_arch_toolbar', 'true');
      const { result } = renderApp();
      expect(result.current.isArchitectureToolbarEnabled).toBe(true);
    });

    it('setIsBasicToolbarEnabled accepts an updater function', () => {
      const { result } = renderApp();
      act(() => {
        result.current.setIsBasicToolbarEnabled(prev => !prev);
      });
      expect(result.current.isBasicToolbarEnabled).toBe(false);
    });

    it('layoutMode defaults to classic and only accepts known values from storage', () => {
      localStorage.setItem('polyform_layout_mode', 'bogus-value');
      const { result } = renderApp();
      expect(result.current.layoutMode).toBe('classic');

      act(() => {
        result.current.setLayoutMode('unified');
      });
      expect(result.current.layoutMode).toBe('unified');
      expect(localStorage.getItem('polyform_layout_mode')).toBe('unified');
    });

    it('toolbarOrder falls back to the default when stored data is malformed', () => {
      localStorage.setItem('polyform_toolbar_order', JSON.stringify(['left', 'left', 'landscapes']));
      const { result } = renderApp();
      expect(result.current.toolbarOrder).toEqual(['left', 'architecture', 'landscapes']);
    });

    it('toolbarOrder accepts a valid stored permutation', () => {
      localStorage.setItem('polyform_toolbar_order', JSON.stringify(['landscapes', 'left', 'architecture']));
      const { result } = renderApp();
      expect(result.current.toolbarOrder).toEqual(['landscapes', 'left', 'architecture']);
    });

    it('toolbarDocks falls back to the default when stored data has an invalid zone', () => {
      localStorage.setItem('polyform_toolbar_docks', JSON.stringify({ left: 'left', architecture: 'nowhere', landscapes: 'left' }));
      const { result } = renderApp();
      expect(result.current.toolbarDocks).toEqual({ left: 'left', architecture: 'left', landscapes: 'left' });
    });

    it('setToolbarDocks persists a valid update', () => {
      const { result } = renderApp();
      act(() => {
        result.current.setToolbarDocks(prev => ({ ...prev, architecture: 'top' }));
      });
      expect(result.current.toolbarDocks.architecture).toBe('top');
      expect(JSON.parse(localStorage.getItem('polyform_toolbar_docks')!)).toEqual(result.current.toolbarDocks);
    });
  });
});
