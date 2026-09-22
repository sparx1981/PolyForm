import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Shape } from '../types';
import { pickHostedFixture } from './hostedFixturePicking';

describe('pickHostedFixture', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const fixture = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.15));
  fixture.userData.id = 'door';
  fixture.updateMatrixWorld();
  const shapes = [{ id: 'door', type: 'door', hostWallId: 'wall' }] as Shape[];
  const getObject = (id: string) => id === 'door' ? fixture : null;

  it('finds a hosted door through its wall at the pointer', () => {
    expect(pickHostedFixture('wall', shapes, camera, new THREE.Vector2(0, 0), getObject)).toBe('door');
  });

  it('leaves unrelated wall clicks alone', () => {
    expect(pickHostedFixture('wall', shapes, camera, new THREE.Vector2(0.9, 0), getObject)).toBeNull();
    expect(pickHostedFixture('other-wall', shapes, camera, new THREE.Vector2(0, 0), getObject)).toBeNull();
  });
});
