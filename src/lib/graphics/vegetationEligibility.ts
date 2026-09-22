import type { Shape, Tag } from '../../types';

export function batchablePlant(shape: Shape, selected: ReadonlySet<string>, tags: Tag[], enabled: boolean, activeTool: string) {
  return enabled && (activeTool === 'select' || activeTool === 'orbit' || activeTool === 'pan' || activeTool === 'zoom' || activeTool === 'eraser')
    && (shape.type === 'tree' || shape.type === 'bush') && Boolean(shape.plantSpeciesId)
    && !shape.hidden && !selected.has(shape.id) && !shape.groupId && !shape.parentShapeId
    && !shape.geometryData && !shape.surfaceDepthEnabled && (shape.opacity ?? 1) === 1
    && (!shape.scale || shape.scale.every(value => Number.isFinite(value) && value > 0))
    && (!shape.tags?.length || shape.tags.some(id => tags.find(tag => tag.id === id)?.visible !== false));
}
