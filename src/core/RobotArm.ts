import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import gsap from 'gsap'
import Log, { log } from '../ui/Log'
import { type LogMessage } from '../ui/Log'
import { throttle } from '../utils/throttle'
import { TrajectoryVisualizer, type TrajectoryPoint } from './TrajectoryVisualizer'
import { WebSocketManager, type WebSocketConfig } from './WebSocketManager'
type JointAxis = 'X' | 'Y' | 'Z'

const throttledLog = throttle(
  (type: LogMessage['type'] = 'debug', logMsg: string) => {
    log[type](`${logMsg}`)
  },
  { interval: 20, leading: true, trailing: true }
)

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

const gripperAxisMap: Record<string, JointAxis> = {
  gripper1: 'Y',
  gripper2: 'Y',
}

export class RobotArm {
  private scene: THREE.Scene
  private model: THREE.Group | null = null
  private joints: Map<string, THREE.Object3D> = new Map()
  private jointConfigs: JointConfig[] = []
  private jointNames: string[] = Object.keys(jointAxisMap)
  private grippers: Map<string, THREE.Object3D> = new Map()
  private gripperConfigs: JointConfig[] = []
  private gripperNames: string[] = Object.keys(gripperAxisMap)
  private allComponentsConfigs: JointConfig[] = []
  private loader: GLTFLoader
  private animationState: AnimationState = {
    isPlaying: false,
    isPaused: false,
    currentProgress: 0,
    currentKeyFrameIndex: 0,
    timeline: null,
    currentSequence: null,
  }
  private gripperAnimationTimeline: gsap.core.Timeline | null = null
  private gripperOpenness: number = 0
  private constantAngularVelocity: number = 360 / 4.8
  private trajectoryVisualizer: TrajectoryVisualizer | null = null
  private trajectoryRecordingInterval: number | null = null
  private currentTrajectoryFrameId: number = 0
  private webSocketManager: WebSocketManager | null = null

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.loader = new GLTFLoader()
    this.loader.setPath(import.meta.env.BASE_URL + 'models/')
    this.trajectoryVisualizer = new TrajectoryVisualizer(scene)
  }

  update(_deltaTime?: number): void {}

  // 加载JSON动作序列
  async loadActionSequence(jsonPath: string) {
    try {
      const response = await fetch(jsonPath)
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
      Log.error(`加载动作序列失败: ${error}`)
      this.animationState.currentSequence = null
      throw error
    }
  }

  // 加载JSON动作序列文件
  async loadActionSequenceFile(file: File) {
    try {
      // 读取文件内容
      const fileContent = await file.text()
      const sequence: JSONActionSequence = JSON.parse(fileContent)

      // 验证数据格式
      await this.validateActionSequence(sequence)

      console.log(`加载动作序列文件: ${sequence.meta.description}`)
      this.animationState.currentSequence = sequence
    } catch (error) {
      console.error('加载动作序列文件失败:', error)
      Log.error(`加载动作序列文件失败: ${error}`)
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
      if (child instanceof THREE.Mesh) {
        child.receiveShadow = false
        child.castShadow = true
      }
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

      if (this.gripperNames.includes(child.name)) {
        const helper = new THREE.AxesHelper(0.1)
        child.add(helper)
        this.grippers.set(child.name, child)
        const axis = gripperAxisMap[child.name]
        const currentAngle = THREE.MathUtils.radToDeg(
          child.rotation[axis.toLocaleLowerCase() as keyof THREE.Euler] as number
        )

        this.gripperConfigs.push({
          name: child.name,
          axis,
          minAngle: child.name === 'gripper1' ? -23 : -30,
          maxAngle: child.name === 'gripper1' ? 30 : 23,
          defaultAngle: currentAngle,
          currentAngle,
        })
      }
    })

    this.allComponentsConfigs = [...this.jointConfigs, ...this.gripperConfigs]
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

    const angles: { name: string; deg: number; rad: number }[] = []
    this.jointConfigs.forEach(config => {
      angles.push({
        name: config.name,
        deg: config.currentAngle,
        rad: THREE.MathUtils.degToRad(config.currentAngle),
      })
    })
    // console.log('current joints angles: ', angles)
    throttledLog('debug', `joints: ${angles.map(angle => `${angle.name}: ${angle.deg}°`)}`)
  }

  /**
   * 使用补间动画设置关节角度
   * @param jointName 关节名称
   * @param targetAngle 目标角度（度）
   * @param duration 动画持续时间（秒），默认0.5秒
   * @param callback 动画回调函数
   */
  animateJointAngle(
    jointName: string,
    targetAngle: number,
    duration: number = 0.5,
    callback?: {
      onStart?: () => void
      onUpdate?: () => void
      onComplete?: () => void
      onInterrupt?: () => void
    }
  ) {
    const joint = this.joints.get(jointName)
    const config = this.jointConfigs.find(c => c.name === jointName)

    if (!joint || !config) {
      const error = `关节 ${jointName} 不存在`
      console.warn(error)
      log.warning(error)
      throw new Error(error)
    }

    // 限制角度范围
    const clampedAngle = Math.max(config.minAngle, Math.min(config.maxAngle, targetAngle))

    if (Math.abs(config.currentAngle - clampedAngle) < 0.01) {
      // 如果目标角度与当前角度几乎相同，直接返回
      log.debug(`关节 ${jointName} 已在目标位置: ${clampedAngle}°`)
      return
    }

    log.info(
      `开始关节动画 - ${jointName}: ${config.currentAngle}° → ${clampedAngle}°, 持续时间: ${duration}s`
    )

    if (this.animationState.timeline) {
      this.animationState.timeline.kill()
      this.animationState.timeline = null
    }
    this.animationState.timeline = gsap.timeline()

    this.animationState.timeline.to(config, {
      currentAngle: clampedAngle,
      duration,
      ease: 'none',
      onUpdate: () => {
        // 在动画过程中更新关节角度
        this.setJointAngle(jointName, config.currentAngle)
        callback?.onUpdate?.()
      },
      onComplete: () => {
        log.success(`关节动画完成 - ${jointName}: ${clampedAngle}°`)
        callback?.onComplete?.()
      },
      onStart: () => {
        callback?.onStart?.()
      },
      onInterrupt: () => {
        callback?.onInterrupt?.()
      },
    })
  }

  /**
   * 同时动画多个关节
   * @param jointAngles 关节角度映射 {关节名: 目标角度}
   * @param duration 动画持续时间（秒），默认0.5秒
   * @param callback 动画回调函数
   */
  animateMultipleJoints(
    jointAngles: Record<string, number>,
    duration: number = 0.5,
    callback?: {
      onStart?: () => void
      onUpdate?: () => void
      onComplete?: () => void
      onInterrupt?: () => void
    }
  ) {
    if (this.animationState.timeline) {
      this.animationState.timeline.kill()
      this.animationState.timeline = null
    }
    this.animationState.timeline = gsap.timeline({
      onStart: () => {
        callback?.onStart?.()
      },
      onComplete: () => {
        callback?.onComplete?.()
      },
      onUpdate: () => {
        callback?.onUpdate?.()
      },
      onInterrupt: () => {
        callback?.onInterrupt?.()
      },
    })
    Object.entries(jointAngles).forEach(([jointName, targetAngle]) => {
      const jointConfig = this.jointConfigs.find(c => c.name === jointName)
      if (jointConfig) {
        this.animationState.timeline!.to(
          jointConfig,
          {
            currentAngle: targetAngle,
            duration: duration,
            ease: 'none',
            onUpdate: () => {
              this.setJointAngle(jointName, jointConfig.currentAngle)
            },
          },
          0
        )
      }
    })
  }

  setGripperAngle(gripperName: string, angle: number): void {
    const gripper = this.grippers.get(gripperName)
    const config = this.gripperConfigs.find(c => c.name === gripperName)
    if (!gripper || !config) {
      console.warn(`机械爪 ${gripperName} 不存在`)
      return
    }
    const clampedAngle = Math.max(config.minAngle, Math.min(config.maxAngle, angle))
    config.currentAngle = clampedAngle

    const rad = THREE.MathUtils.degToRad(clampedAngle)
    switch (config.axis) {
      case 'X':
        gripper.rotation.x = rad
        break
      case 'Y':
        gripper.rotation.y = rad
        break
      case 'Z':
        gripper.rotation.z = rad
        break
    }

    const angles: { name: string; deg: number; rad: number }[] = []
    this.gripperConfigs.forEach(config => {
      angles.push({
        name: config.name,
        deg: config.currentAngle,
        rad: THREE.MathUtils.degToRad(config.currentAngle),
      })
    })
    console.log('current grippers angles: ', angles)
    // throttledLog('debug', `grippers: ${angles.map(angle => `${angle.name}: ${angle.deg}°`)}`)
  }

  /**
   *
   * @param openness 机械爪开合程度，0为完全闭合，1为完全张开
   */
  setGripperOpenness(openness: number): void {
    // 限制openness范围在0-1之间
    const clampedOpenness = Math.max(0, Math.min(1, openness))

    const gripper1Config = this.gripperConfigs.find(c => c.name === 'gripper1')
    const gripper2Config = this.gripperConfigs.find(c => c.name === 'gripper2')
    if (!gripper1Config || !gripper2Config) {
      console.warn('机械爪不存在')
      return
    }
    // 为两个机械爪设置对称角度
    const gripper1Angle =
      gripper1Config.minAngle +
      clampedOpenness * (gripper1Config.maxAngle - gripper1Config.minAngle)

    const gripper2Angle =
      gripper2Config.maxAngle +
      clampedOpenness * (gripper2Config.minAngle - gripper2Config.maxAngle)

    // 设置两个机械爪的角度
    this.setGripperAngle('gripper1', gripper1Angle)
    this.setGripperAngle('gripper2', gripper2Angle)

    throttledLog('debug', `gripper openness: ${clampedOpenness}`)
  }

  getJointAngle(jointName: string): number {
    const config = this.jointConfigs.find(c => c.name === jointName)
    return config?.currentAngle || 0
  }

  getGripperAngle(gripperName: string): number {
    const config = this.gripperConfigs.find(c => c.name === gripperName)
    return config?.currentAngle || 0
  }

  getJointConfigs(): JointConfig[] {
    return [...this.jointConfigs]
  }

  getGripperConfigs(): JointConfig[] {
    return [...this.gripperConfigs]
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
    this.grippers.forEach(gripper => {
      const helper = gripper.children.find(child => child instanceof THREE.AxesHelper)
      if (helper) {
        helper.visible = visible !== undefined ? visible : !helper.visible
      }
    })
  }

  reset0(options?: { onUpdate?: (config: JointConfig) => void; onComplete?: () => void }): void {
    // 停止所有现有动画
    this.stopAllJointAnimations()

    this.allComponentsConfigs.forEach(config => {
      gsap.killTweensOf(config, 'currentAngle')
      const duration = Math.abs(config.currentAngle - 0) / this.constantAngularVelocity // 保持匀速运动
      gsap.to(config, {
        currentAngle: 0,
        duration,
        ease: 'none',
        onUpdate: () => {
          config.name.includes('gripper')
            ? this.setGripperAngle(config.name, config.currentAngle)
            : this.setJointAngle(config.name, config.currentAngle)
          options?.onUpdate?.(config)
        },
        onComplete: () => {
          options?.onComplete?.()
        },
      })
    })
  }

  resetToDefault(options?: {
    onUpdate?: (config: JointConfig) => void
    onComplete?: () => void
  }): void {
    // 停止所有现有动画
    this.stopAllJointAnimations()

    this.allComponentsConfigs.forEach(config => {
      gsap.killTweensOf(config, 'currentAngle')
      const duration =
        Math.abs(config.currentAngle - config.defaultAngle) / this.constantAngularVelocity // 保持匀速运动,
      gsap.to(config, {
        currentAngle: config.defaultAngle,
        duration,
        ease: 'none',
        onUpdate: () => {
          config.name.includes('gripper')
            ? this.setGripperAngle(config.name, config.currentAngle)
            : this.setJointAngle(config.name, config.currentAngle)
          options?.onUpdate?.(config)
        },
        onComplete: () => {
          options?.onComplete?.()
        },
      })
    })
  }

  // 动画驱动机械爪开合
  animateGripperOpenness(openness: number, duration: number = 0.5): void {
    if (this.gripperAnimationTimeline) {
      this.gripperAnimationTimeline.kill()
    }
    this.gripperAnimationTimeline = gsap.timeline()
    this.gripperAnimationTimeline.to(this, {
      gripperOpenness: openness,
      duration: duration,
      ease: 'none',
      onUpdate: () => {
        this.setGripperOpenness(this.gripperOpenness)
      },
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
      if (!this.animationState.currentSequence) {
        await this.loadActionSequence(jsonPath)
      }

      const sequence = this.animationState.currentSequence!

      // 停止之前的动画
      this.stopAnimation()

      // 开始新的轨迹记录
      const sequenceId = `${sequence.meta.description}_${sequence.meta.created}`
      this.trajectoryVisualizer?.startNewTrajectory(sequenceId)
      this.currentTrajectoryFrameId = 0

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
          this.stopTrajectoryRecording()
          this.trajectoryVisualizer?.finishTrajectory()
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
        frame.joints.forEach((angleRad, jointIndex) => {
          if (jointIndex < this.jointNames.length) {
            const jointName = this.jointNames[jointIndex]
            const config = this.jointConfigs.find(c => c.name === jointName)
            if (config) {
              // 将弧度转换为角度
              const targetAngle = THREE.MathUtils.radToDeg(angleRad)

              this.animationState.timeline!.to(
                config,
                {
                  currentAngle: targetAngle,
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

        // 处理IO状态变化（机械爪）
        if (frame.io?.digital_output_0 !== undefined) {
          const openness = frame.io!.digital_output_0 ? 0 : 1
          this.animationState.timeline!.call(
            () => {
              this.animateGripperOpenness(openness)
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

      // 开始轨迹记录
      this.startTrajectoryRecording()
    } catch (error) {
      console.error('播放动作序列失败:', error)
      this.stopTrajectoryRecording()
      throw error
    }
  }

  // 暂停动画
  pauseAnimation(): void {
    if (this.animationState.timeline && this.animationState.isPlaying) {
      this.animationState.timeline.pause()
      this.animationState.isPaused = true
      this.pauseTrajectoryRecording()
    }
  }

  // 恢复动画
  resumeAnimation(): void {
    if (this.animationState.timeline && this.animationState.isPaused) {
      this.animationState.timeline.play()
      this.animationState.isPaused = false
      this.resumeTrajectoryRecording()
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
    this.stopTrajectoryRecording()
  }

  /**
   * 停止所有关节动画
   */
  stopAllJointAnimations(): void {
    // 停止所有关节的GSAP动画
    this.jointConfigs.forEach(config => {
      gsap.killTweensOf(config)
    })
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

      // 设置机械爪状态
      if (targetFrame.io?.digital_output_0 !== undefined) {
        const openness = targetFrame.io!.digital_output_0 ? 0 : 1
        this.animateGripperOpenness(openness)
      }

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

  // 开始轨迹记录
  private startTrajectoryRecording(): void {
    // 清除之前的记录定时器
    this.stopTrajectoryRecording()

    // 每隔一定时间记录一次末端执行器位置
    const recordInterval = 20 // 20ms 记录一次
    this.trajectoryRecordingInterval = window.setInterval(() => {
      this.recordTrajectoryPoint()
    }, recordInterval)
  }

  // 停止轨迹记录
  private stopTrajectoryRecording(): void {
    if (this.trajectoryRecordingInterval !== null) {
      window.clearInterval(this.trajectoryRecordingInterval)
      this.trajectoryRecordingInterval = null
    }
  }

  // 暂停轨迹记录
  private pauseTrajectoryRecording(): void {
    this.stopTrajectoryRecording()
  }

  // 恢复轨迹记录
  private resumeTrajectoryRecording(): void {
    this.startTrajectoryRecording()
  }

  // 记录轨迹点
  private recordTrajectoryPoint(): void {
    const position = TrajectoryVisualizer.getEndEffectorPosition(this.model)
    if (position) {
      const point: TrajectoryPoint = {
        position: position.clone(),
        time: Date.now(),
        frameId: this.currentTrajectoryFrameId++,
      }
      this.trajectoryVisualizer?.addTrajectoryPoint(point)
    }
  }

  // 获取轨迹可视化器
  getTrajectoryVisualizer(): TrajectoryVisualizer | null {
    return this.trajectoryVisualizer
  }

  // 清除轨迹
  clearTrajectory(): void {
    this.trajectoryVisualizer?.clear()
  }

  // WebSocket相关方法
  async initializeWebSocket(config: WebSocketConfig): Promise<void> {
    try {
      this.webSocketManager = new WebSocketManager(config)
      await this.webSocketManager.initialize(this)

      // 设置回调函数
      this.webSocketManager.onConnectionStatus(connected => {
        log.info(`WebSocket ${connected ? '已连接' : '已断开'}`)
      })

      this.webSocketManager.onRemoteCommand((command, _data) => {
        log.info(`收到远程命令: ${command}`)
      })

      console.log('WebSocket初始化成功')
    } catch (error) {
      console.error('WebSocket初始化失败:', error)
      log.error(`WebSocket初始化失败: ${error}`)
      throw error
    }
  }

  connectWebSocket(): Promise<void> {
    if (!this.webSocketManager) {
      throw new Error('WebSocket未初始化')
    }
    return this.webSocketManager.connect()
  }

  disconnectWebSocket(): void {
    if (this.webSocketManager) {
      this.webSocketManager.disconnect()
    }
  }

  getWebSocketManager(): WebSocketManager | null {
    return this.webSocketManager
  }

  isWebSocketConnected(): boolean {
    return this.webSocketManager?.isConnected() || false
  }
}
