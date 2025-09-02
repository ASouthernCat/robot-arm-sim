import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath(import.meta.env.BASE_URL + 'draco/')

type JointAxis = 'X' | 'Y' | 'Z'

export interface JointConfig {
  name: string
  axis: JointAxis
  minAngle: number
  maxAngle: number
  defaultAngle: number
  currentAngle: number
}

const jointAxisMap: Record<string, JointAxis> = {
  base1: 'Y',
  shoulder: 'X',
  elbow1: 'X',
  elbow2: 'X',
  wrist1: 'Z',
}

export class RobotArm {
  private scene: THREE.Scene
  private model: THREE.Group | null = null
  private joints: Map<string, THREE.Object3D> = new Map()
  private jointConfigs: JointConfig[] = []
  private jointNames: string[] = Object.keys(jointAxisMap)
  private loader: GLTFLoader

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.loader = new GLTFLoader()
    this.loader.setDRACOLoader(dracoLoader)
  }

  update(_deltaTime?: number): void {}

  async loadModel(modelPath: string): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync(modelPath)
      this.model = gltf.scene
      console.log(this.model)

      // 设置模型的基本属性
      this.model.scale.setScalar(1)
      this.model.position.set(0, 0, 0)

      // 添加到场景
      this.scene.add(this.model)

      // 初始化关节配置
      this.initializeJoints()

      console.log('机械臂模型加载成功')
    } catch (error) {
      console.error('机械臂模型加载失败:', error)
      throw error
    }
  }

  private initializeJoints(): void {
    if (!this.model) return

    // 遍历模型查找关节
    this.model.traverse(child => {
      if (this.jointNames.includes(child.name)) {
        const helper = new THREE.AxesHelper(0.1)
        child.add(helper)
        this.joints.set(child.name, child)

        const axis = jointAxisMap[child.name]
        const currentAngle = THREE.MathUtils.radToDeg(
          child.rotation[axis.toLocaleLowerCase() as keyof THREE.Euler] as number
        )

        // 为每个关节创建默认配置
        this.jointConfigs.push({
          name: child.name,
          axis,
          minAngle: -180,
          maxAngle: 180,
          defaultAngle: currentAngle,
          currentAngle,
        })
      }
    })

    console.log(`找到 ${this.joints.size} 个关节`)
  }

  setJointAngle(jointName: string, angle: number): void {
    const joint = this.joints.get(jointName)
    const config = this.jointConfigs.find(c => c.name === jointName)

    if (!joint || !config) {
      console.warn(`关节 ${jointName} 不存在`)
      return
    }

    // 限制角度范围
    const clampedAngle = Math.max(config.minAngle, Math.min(config.maxAngle, angle))
    config.currentAngle = clampedAngle

    // 应用旋转
    const rad = THREE.MathUtils.degToRad(clampedAngle)
    switch (config.axis) {
      case 'X':
        joint.rotation.x = rad
        break
      case 'Y':
        joint.rotation.y = rad
        break
      case 'Z':
        joint.rotation.z = rad
        break
    }
  }

  getJointAngle(jointName: string): number {
    const config = this.jointConfigs.find(c => c.name === jointName)
    return config?.currentAngle || 0
  }

  getJointConfigs(): JointConfig[] {
    return [...this.jointConfigs]
  }

  getModel(): THREE.Group | null {
    return this.model
  }

  toggleAxisHelper(visible?: boolean): void {
    this.joints.forEach(joint => {
      const helper = joint.children.find(child => child instanceof THREE.AxesHelper)
      if (helper) {
        helper.visible = visible !== undefined ? visible : !helper.visible
      }
    })
  }
}
