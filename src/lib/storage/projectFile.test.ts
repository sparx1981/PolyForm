import { describe, expect, it } from 'vitest';
import { buildProjectFile, parseProjectFile, projectFileName, ProjectFileError, PROJECT_FILE_VERSION } from './projectFile';

const state = {
  name: 'House',
  shapes: [{ id: 'a', type: 'box' }],
  tags: [],
  scenes: [],
  customMaterials: [],
  animations: [],
  notes: [],
  customLights: [],
  timberFrameParams: { studSpacing: 0.6 },
  terrainModifiers: [{ id: 't', type: 'road' }],
  kernel: { vertices: [[1, [0, 0, 0]]] },
};

describe('project file', () => {
  it('round-trips everything, including drawn geometry and terrain edits', () => {
    const text = buildProjectFile(state, new Date('2026-01-01T00:00:00Z'));
    const data = JSON.parse(text);
    expect(data.format).toBe('polyform');
    expect(data.version).toBe(PROJECT_FILE_VERSION);
    const back = parseProjectFile(text);
    expect(back.shapes).toEqual(state.shapes);
    expect(back.kernel).toEqual(state.kernel);
    expect(back.timberFrameParams).toEqual(state.timberFrameParams);
    expect(back.terrainModifiers).toEqual(state.terrainModifiers);
    expect(back.name).toBe('House');
  });

  it('reads older files that have no drawn geometry', () => {
    const back = parseProjectFile(JSON.stringify({ format: 'polyform', version: 3, shapes: [{ id: 'x' }] }));
    expect(back.shapes).toHaveLength(1);
    expect(back.kernel).toBeNull();
    expect(back.tags).toEqual([]);
  });

  it('refuses files that are not PolyForm projects or come from a newer version', () => {
    expect(() => parseProjectFile('not json')).toThrow(ProjectFileError);
    expect(() => parseProjectFile('{"hello":1}')).toThrow(/not a PolyForm project/);
    expect(() => parseProjectFile(JSON.stringify({ format: 'polyform', version: 99, shapes: [] }))).toThrow(/newer version/);
  });

  it('makes safe file names', () => {
    expect(projectFileName('My House / v2')).toBe('My House _ v2.polyform');
    expect(projectFileName('???')).toBe('___.polyform');
  });
});
