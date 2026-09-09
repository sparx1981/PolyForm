import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Shape, Tag } from '../types';

interface InstancedTimberFramingProps {
  shapes: Shape[];
  tags: Tag[];
  selectedId: string | null;
  selectedIds?: string[];
  onSelectShape?: (id: string) => void;
  shadowsEnabled?: boolean;
}

type TimberKind =
  | 'stud'
  | 'plate'
  | 'header'
  | 'sill'
  | 'jackStud'
  | 'kingStud'
  | 'rafter'
  | 'joist'
  | 'blocking';

interface KindConfig {
  defaultColor: string;
  roughness: number;
  metalness: number;
}

const KIND_CONFIGS: Record<TimberKind, KindConfig> = {
  stud: { defaultColor: '#d97706', roughness: 0.8, metalness: 0.05 },
  plate: { defaultColor: '#b45309', roughness: 0.8, metalness: 0.05 },
  header: { defaultColor: '#92400e', roughness: 0.75, metalness: 0.05 },
  sill: { defaultColor: '#b45309', roughness: 0.8, metalness: 0.05 },
  jackStud: { defaultColor: '#d97706', roughness: 0.8, metalness: 0.05 },
  kingStud: { defaultColor: '#b45309', roughness: 0.8, metalness: 0.05 },
  rafter: { defaultColor: '#92400e', roughness: 0.8, metalness: 0.05 },
  joist: { defaultColor: '#b45309', roughness: 0.8, metalness: 0.05 },
  blocking: { defaultColor: '#d97706', roughness: 0.85, metalness: 0.05 },
};

function resolveTimberKind(shape: Shape): TimberKind {
  const tags = shape.tags || [];
  const name = shape.name || '';
  if (tags.includes('timber-jack-stud')) return 'jackStud';
  if (tags.includes('timber-king-stud')) return 'kingStud';
  if (tags.includes('timber-lintel') || tags.includes('timber-header')) return 'header';
  if (tags.includes('timber-sill')) return 'sill';
  if (tags.includes('timber-top-plate') || tags.includes('timber-bottom-plate') || tags.includes('timber-plate') || name.includes('Plate')) return 'plate';
  if (tags.includes('timber-roof-rafter') || tags.includes('timber-rafter') || tags.includes('timber-hip-rafter') || tags.includes('timber-ridge-beam') || tags.includes('timber-collar-tie') || tags.includes('timber-valley-rafter') || name.includes('Rafter') || name.includes('Ridge') || name.includes('Tie')) return 'rafter';
  if (tags.includes('timber-floor-joist') || tags.includes('timber-joist') || tags.includes('timber-rim-joist') || tags.includes('timber-trimmer-joist') || tags.includes('timber-header-joist') || tags.includes('timber-strutting') || tags.includes('timber-bearing-blocking') || tags.includes('timber-floor') || name.includes('Joist') || name.includes('Rim') || name.includes('Trimmer') || name.includes('Strut') || name.startsWith('FLOOR_')) return 'joist';
  if (tags.includes('timber-blocking') || tags.includes('timber-noggin') || name.includes('Noggin') || name.includes('NOGGIN') || name.includes('Blocking')) return 'blocking';
  return 'stud';
}

const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempColor = new THREE.Color();
const highlightColor = new THREE.Color('#38bdf8');

function InstancedMeshGroup({
  kind,
  items,
  selectedSet,
  onSelectShape,
  shadowsEnabled
}: {
  kind: TimberKind;
  items: Shape[];
  selectedSet: Set<string>;
  onSelectShape?: (id: string) => void;
  shadowsEnabled?: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const config = KIND_CONFIGS[kind];
  const count = items.length;

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;

    for (let i = 0; i < count; i++) {
      const item = items[i];
      tempPosition.set(item.position[0], item.position[1], item.position[2]);

      if (item.quaternion) {
        tempQuaternion.set(item.quaternion[0], item.quaternion[1], item.quaternion[2], item.quaternion[3]);
      } else if (item.rotation) {
        tempQuaternion.setFromEuler(new THREE.Euler(item.rotation[0], item.rotation[1], item.rotation[2]));
      } else {
        tempQuaternion.identity();
      }

      const args = Array.isArray(item.args) ? item.args : [0.045, 2.4, 0.14];
      const width = args[0] || 0.045;
      const height = args[1] || 2.4;
      const depth = args[2] || 0.14;
      const sx = item.scale ? item.scale[0] * width : width;
      const sy = item.scale ? item.scale[1] * height : height;
      const sz = item.scale ? item.scale[2] * depth : depth;
      tempScale.set(sx, sy, sz);

      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(i, tempMatrix);

      const isSelected = selectedSet.has(item.id);
      if (isSelected) {
        mesh.setColorAt(i, highlightColor);
      } else if (item.color) {
        tempColor.set(item.color);
        mesh.setColorAt(i, tempColor);
      } else {
        tempColor.set(config.defaultColor);
        mesh.setColorAt(i, tempColor);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [items, selectedSet, count, config]);

  if (count === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[unitBoxGeometry, undefined, count]}
      castShadow={Boolean(shadowsEnabled)}
      receiveShadow={Boolean(shadowsEnabled)}
      onPointerDown={(e) => {
        e.stopPropagation();
        const instanceId = e.instanceId;
        if (instanceId !== undefined && items[instanceId] && onSelectShape) {
          onSelectShape(items[instanceId].id);
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        const instanceId = e.instanceId;
        if (instanceId !== undefined && items[instanceId] && onSelectShape) {
          onSelectShape(items[instanceId].id);
        }
      }}
    >
      <meshStandardMaterial
        color={config.defaultColor}
        roughness={config.roughness}
        metalness={config.metalness}
      />
    </instancedMesh>
  );
}

export function InstancedTimberFraming({
  shapes,
  tags,
  selectedId,
  selectedIds,
  onSelectShape,
  shadowsEnabled
}: InstancedTimberFramingProps) {
  const selectedSet = useMemo(() => {
    const set = new Set<string>();
    if (selectedId) set.add(selectedId);
    if (selectedIds) {
      selectedIds.forEach(id => set.add(id));
    }
    return set;
  }, [selectedId, selectedIds]);

  const visibleTimberShapes = useMemo(() => {
    return shapes.filter(shape => {
      if (shape.hidden) return false;
      const isTimber = shape.tags?.includes('timber-frame') || shape.name?.startsWith('Timber ') || shape.id.startsWith('tf-');
      if (!isTimber) return false;

      // Tag visibility
      if (shape.tags && shape.tags.length > 0) {
        const isTagVisible = shape.tags.some(tagId => {
          const tag = tags.find(t => t.id === tagId);
          return tag ? tag.visible : true;
        });
        if (!isTagVisible) return false;
      }
      return true;
    });
  }, [shapes, tags]);

  const kindBuckets = useMemo(() => {
    const buckets: Record<TimberKind, Shape[]> = {
      stud: [],
      plate: [],
      header: [],
      sill: [],
      jackStud: [],
      kingStud: [],
      rafter: [],
      joist: [],
      blocking: [],
    };

    visibleTimberShapes.forEach(shape => {
      const kind = resolveTimberKind(shape);
      buckets[kind].push(shape);
    });

    return buckets;
  }, [visibleTimberShapes]);

  if (visibleTimberShapes.length === 0) return null;

  return (
    <group name="instanced-timber-framing">
      {(Object.keys(kindBuckets) as TimberKind[]).map(kind => (
        <InstancedMeshGroup
          key={kind}
          kind={kind}
          items={kindBuckets[kind]}
          selectedSet={selectedSet}
          onSelectShape={onSelectShape}
          shadowsEnabled={shadowsEnabled}
        />
      ))}
    </group>
  );
}
