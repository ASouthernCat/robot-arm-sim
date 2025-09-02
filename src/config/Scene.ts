import * as THREE from 'three'

export const SceneConfig = {
  background: {
    color: 0xefefef,
  },
  camera: {
    defaultPos: new THREE.Vector3(2, 3, -2),
  },
  controls: {
    defaultTarget: new THREE.Vector3(0, 1.5, 0),
  },
}
