import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import gsap from 'gsap'

type JointAxis = 'X' | 'Y' | 'Z'

export interface JointConfig {
  name: string
  axis: JointAxis
  minAngle: number
  maxAngle: number
  defaultAngle: number
  currentAngle: number
}

export interface JSONKeyFrame {
  id: number
  time: number // 毫秒
  joints: number[] // 弧度
  cartesian?: {
    position: [number, number, number]
    orientation: [number, number, number, number] // 四元数 [x, y, z, w]
  } | null
  io?: {
    digital_output_0?: boolean // 机械爪状态，true为闭合，false为张开
  }
}

export interface JSONActionSequence {
  meta: {
    version: string
    description: string
    created: string
    robot_type: string
  }
  frames: JSONKeyFrame[]
}

export interface AnimationState {
  isPlaying: boolean
  isPaused: boolean
  currentProgress: number
  currentKeyFrameIndex: number
  timeline: gsap.core.Timeline | null
  currentSequence: JSONActionSequence | null
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
  private animationState: AnimationState = {
    isPlaying: false,
    isPaused: false,
    currentProgress: 0,
    currentKeyFrameIndex: 0,
    timeline: null,
    currentSequence: null,
  }

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.loader = new GLTFLoader()
    this.loader.setPath(import.meta.env.BASE_URL + 'models/')
  }

  update(_deltaTime?: number): void {}

  // 加载JSON动作序列
  async loadActionSequence(jsonPath: string) {
    try {
      const response = await fetch(import.meta.env.BASE_URL + 'actions/' + jsonPath)
      if (!response.ok) {
        throw new Error(`Failed to load action sequence: ${response.statusText}`)
      }
      const sequence: JSONActionSequence = await response.json()

      // 验证数据格式
      await this.validateActionSequence(sequence)

      console.log(`加载动作序列: ${sequence.meta.description}`)
      this.animationState.currentSequence = sequence
    } catch (error) {
      console.error('加载动作序列失败:', error)
      this.animationState.currentSequence = null
      throw error
    }
  }

  // 验证JSON数据格式
  private async validateActionSequence(sequence: JSONActionSequence) {
    return new Promise((resolve, reject) => {
      try {
        if (!Array.isArray(sequence.frames) || sequence.frames.length === 0) {
          reject(new Error('Action sequence must contain at least one frame'))
        }
        sequence.frames.forEach((frame, index) => {
          if (!Array.isArray(frame.joints) || frame.joints.length !== this.jointNames.length) {
            reject(
              new Error(`Frame ${index}: joints array must have ${this.jointNames.length} values`)
            )
          }
          if (typeof frame.time !== 'number') {
            reject(new Error(`Frame ${index}: time must be a number`))
          }
        })
        resolve(true)
      } catch (error) {
        reject(error)
      }
    })
  }

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
          minAngle: -360,
          maxAngle: 360,
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

    const angles: {name: string, deg: number, rad: number}[] = []
    this.jointConfigs.forEach(config => {
      angles.push({name: config.name, deg: config.currentAngle, rad: THREE.MathUtils.degToRad(config.currentAngle)})
    })
    console.log('current joints angles: ', angles)
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

  reset0(options: { onUpdate?: (config: JointConfig) => void, onComplete?: () => void }): void {
    this.jointConfigs.forEach(config => {
      gsap.killTweensOf(config, 'currentAngle')
      const duration = (1 - Math.abs(config.currentAngle - 0) / 360) * 1 // 保持匀速运动
      gsap.to(config, {
        currentAngle: 0,
        duration,
        ease: 'none',
        onUpdate: () => {
          this.setJointAngle(config.name, config.currentAngle)
          options.onUpdate?.(config)
        },
        onComplete: () => {
          options.onComplete?.()
        },
      })
    })
  }

  resetToDefault(options: { onUpdate?: (config: JointConfig) => void, onComplete?: () => void }): void {
    this.jointConfigs.forEach(config => {
      gsap.killTweensOf(config, 'currentAngle')
      const duration = (Math.abs(config.currentAngle - config.defaultAngle) / 360) * 3 // 保持匀速运动
      gsap.to(config, {
        currentAngle: config.defaultAngle,
        duration,
        ease: 'none',
        onUpdate: () => {
          this.setJointAngle(config.name, config.currentAngle)
          options.onUpdate?.(config)
        },
        onComplete: () => {
          options.onComplete?.()
        },
      })
    })
  }

  async playActionSequence(
    jsonPath: string,
    options: {
      onUpdate?: (config: JointConfig) => void
      onProgressUpdate?: (progress: number) => void
      onStateChange?: (frameId: number, frame: JSONKeyFrame) => void
      onGripperChange?: (isGripping: boolean) => void
      onComplete?: () => void
    } = {}
  ): Promise<void> {
    if (this.animationState.isPlaying && !this.animationState.isPaused) {
      return // 已在播放中
    }

    // 如果是暂停状态，则恢复播放
    if (this.animationState.isPaused) {
      this.resumeAnimation()
      return
    }

    try {
      // 如果序列未加载，先加载
      if (
        !this.animationState.currentSequence ||
        this.animationState.currentSequence.meta.description !== jsonPath
      ) {
        await this.loadActionSequence(jsonPath)
      }

      const sequence = this.animationState.currentSequence!

      // 停止之前的动画
      this.stopAnimation()

      // 创建新的时间线
      this.animationState.timeline = gsap.timeline({
        onUpdate: () => {
          const progress = this.animationState.timeline!.progress()
          this.animationState.currentProgress = progress
          options.onProgressUpdate?.(progress)
        },
        onComplete: () => {
          this.animationState.isPlaying = false
          this.animationState.isPaused = false
          this.animationState.currentProgress = 1
          options.onProgressUpdate?.(1)
          options.onComplete?.()
        },
      })

      // 获取总时长（用于调试信息）
      const totalDuration = sequence.frames[sequence.frames.length - 1].time
      console.log(`动作总时长: ${totalDuration}ms`)

      let timeTick = 0
      // 为每个关键帧添加动画
      sequence.frames.forEach((frame, index) => {
        const timeInSeconds = frame.time / 1000
        let frameDuration = 0

        if (index === 0) {
          // 第一帧：从当前位置平滑过渡到第一帧位置
          frameDuration = Math.min(5, Math.max(timeInSeconds, 1.5)) // 1.5-5 秒的过渡时间
        } else {
          const prevTimeInSeconds = sequence.frames[index - 1].time / 1000
          frameDuration = timeInSeconds - prevTimeInSeconds
        }

        // 为每个关节创建动画
        frame.joints.forEach((jointAngle, jointIndex) => {
          if (jointIndex < this.jointNames.length) {
            const jointName = this.jointNames[jointIndex]
            const config = this.jointConfigs.find(c => c.name === jointName)
            if (config) {
              // 将弧度转换为角度
              const angleDeg = THREE.MathUtils.radToDeg(jointAngle)

              this.animationState.timeline!.to(
                config,
                {
                  currentAngle: angleDeg,
                  duration: frameDuration,
                  ease: 'none',
                  onUpdate: () => {
                    this.setJointAngle(config.name, config.currentAngle)
                    options.onUpdate?.(config)
                  },
                },
                timeTick // 第一帧从0秒开始
              )
            }
          }
        })

        // TODO: 处理IO状态变化（机械爪）
        if (frame.io?.digital_output_0 !== undefined) {
          this.animationState.timeline!.call(
            () => {
              options.onGripperChange?.(frame.io!.digital_output_0!)
            },
            [],
            timeTick
          )
        }

        // 状态变化回调
        this.animationState.timeline!.call(
          () => {
            this.animationState.currentKeyFrameIndex = index
            options.onStateChange?.(frame.id, frame)
          },
          [],
          timeTick
        )

        // 更新下一帧的时间戳
        timeTick += frameDuration
      })

      this.animationState.isPlaying = true
      this.animationState.isPaused = false
    } catch (error) {
      console.error('播放动作序列失败:', error)
      throw error
    }
  }

  // 暂停动画
  pauseAnimation(): void {
    if (this.animationState.timeline && this.animationState.isPlaying) {
      this.animationState.timeline.pause()
      this.animationState.isPaused = true
    }
  }

  // 恢复动画
  resumeAnimation(): void {
    if (this.animationState.timeline && this.animationState.isPaused) {
      this.animationState.timeline.play()
      this.animationState.isPaused = false
    }
  }

  // 停止动画
  stopAnimation(): void {
    if (this.animationState.timeline) {
      this.animationState.timeline.kill()
      this.animationState.timeline = null
    }
    this.animationState.isPlaying = false
    this.animationState.isPaused = false
    this.animationState.currentProgress = 0
    this.animationState.currentKeyFrameIndex = 0
  }

  // 设置动画进度
  setAnimationProgress(progress: number): void {
    if (this.animationState.isPlaying && !this.animationState.isPaused) {
      return
    }
    if (this.animationState.currentSequence) {
      // 如果有加载的序列，直接设置关节位置
      const sequence = this.animationState.currentSequence
      const totalDuration = sequence.frames[sequence.frames.length - 1].time
      const targetTime = totalDuration * progress

      // 找到对应的关键帧
      let targetFrameIndex = 0
      for (let i = 0; i < sequence.frames.length - 1; i++) {
        if (targetTime >= sequence.frames[i].time && targetTime <= sequence.frames[i + 1].time) {
          targetFrameIndex = i
          break
        }
      }
      if (targetTime >= sequence.frames[sequence.frames.length - 1].time) {
        targetFrameIndex = sequence.frames.length - 1
      }

      const targetFrame = sequence.frames[targetFrameIndex]
      const nextFrame =
        targetFrameIndex < sequence.frames.length - 1 ? sequence.frames[targetFrameIndex + 1] : null

      // 计算插值
      let interpolation = 0
      if (nextFrame) {
        const frameDuration = nextFrame.time - targetFrame.time
        const frameProgress = targetTime - targetFrame.time
        interpolation = frameProgress / frameDuration
      }

      // 设置关节角度
      targetFrame.joints.forEach((jointAngle, jointIndex) => {
        if (jointIndex < this.jointNames.length) {
          const jointName = this.jointNames[jointIndex]
          const config = this.jointConfigs.find(c => c.name === jointName)
          if (config) {
            let finalAngle = THREE.MathUtils.radToDeg(jointAngle)

            // 如果有下一帧，进行插值
            if (nextFrame && interpolation > 0) {
              const nextAngle = THREE.MathUtils.radToDeg(nextFrame.joints[jointIndex])
              finalAngle = finalAngle + (nextAngle - finalAngle) * interpolation
            }

            config.currentAngle = finalAngle
            this.setJointAngle(config.name, config.currentAngle)
          }
        }
      })

      this.animationState.currentProgress = progress
      this.animationState.currentKeyFrameIndex = targetFrameIndex
    }
  }

  // 获取动画状态
  getAnimationState(): AnimationState {
    return { ...this.animationState }
  }

  // 获取当前加载的动作序列
  getCurrentSequence(): JSONActionSequence | null {
    return this.animationState.currentSequence
  }

  // 清除当前加载的动作序列
  clearCurrentSequence(): void {
    this.animationState.currentSequence = null
  }
}
