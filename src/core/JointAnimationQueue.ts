import { log } from '../ui/Log'
import type { RobotArm } from './RobotArm'

// 帧数据
export interface FrameData {
  id: number
  time: number // 毫秒
  joints: number[] // 弧度
  cartesian?: {
    position: [number, number, number]
    orientation: [number, number, number, number] // 四元数 [x, y, z, w]
  } | null
  io?: {
    digital_output_0?: boolean // 机械爪状态
  }
}

// 播放回调选项
export interface PlayCallbackOptions {
  onFrameUpdate?: (frame: FrameData) => void
  onFrameComplete?: (frame: FrameData) => void
  onError?: (frame: FrameData, error?: any) => void
}

// 播放状态
type PlayStatus = 'idle' | 'playing' | 'stopped'

/**
 * 帧动画队列管理器
 * 负责管理从WebSocket接收的动作序列帧，使用队列机制确保帧的顺序执行
 */
export class JointAnimationQueue {
  private robotArm: RobotArm | null = null
  private frameQueue: FrameData[] = [] // 帧队列（FIFO）
  private status: PlayStatus = 'idle'
  private playCallbackOptions: PlayCallbackOptions = {}
  private isProcessing: boolean = false // 是否正在处理队列
  private animationLoopId: number | null = null // 动画循环ID
  private lastProcessedFrame: FrameData | null = null // 上一次已执行的帧

  setRobotArm(robotArm: RobotArm): void {
    this.robotArm = robotArm
  }

  startSequence(options: PlayCallbackOptions = {}): void {
    log.info('开始接收动作序列帧...')
    console.log('开始接收动作序列帧...')
    this.status = 'playing'
    this.playCallbackOptions = options
    this.frameQueue = []
    this.lastProcessedFrame = null
    this.isProcessing = false
    this.startAnimationLoop()
  }

  enqueueFrame(frame: FrameData): void {
    this.frameQueue.push(frame)
    log.debug(`帧 ${frame.id} 已加入队列，当前队列长度: ${this.frameQueue.length}`)
    console.log(`帧 ${frame.id} 已加入队列，当前队列长度: ${this.frameQueue.length}`)
  }

  private startAnimationLoop(): void {
    if (this.animationLoopId !== null) return
    const loop = () => {
      if (this.status === 'playing' && !this.isProcessing) {
        this.processQueue()
      }
      this.animationLoopId = requestAnimationFrame(loop)
    }
    this.animationLoopId = requestAnimationFrame(loop)
  }

  private stopAnimationLoop(): void {
    if (this.animationLoopId !== null) {
      cancelAnimationFrame(this.animationLoopId)
      this.animationLoopId = null
    }
  }

  private processQueue(): void {
    if (this.isProcessing) return
    if (!this.robotArm) return
    // 只要队列中有帧就出队执行
    if (this.frameQueue.length > 0) {
      this.isProcessing = true
      const currentFrame = this.frameQueue.shift()!
      const nextFrame = this.frameQueue[0]
      this.executeFrame(currentFrame, nextFrame)
    }
  }

  private executeFrame(frame: FrameData, nextFrame?: FrameData): void {
    if (!this.robotArm) {
      this.isProcessing = false
      return
    }
    try {
      console.log('执行帧：', frame)
      const duration = this.calculateFrameDuration(frame, nextFrame)
      const jointConfigs = this.robotArm.getJointConfigs()
      const jointAngles: Record<string, number> = {}
      frame.joints.forEach((angleRad, index) => {
        if (index < jointConfigs.length) {
          const jointName = jointConfigs[index].name
          const angleDeg = (angleRad * 180) / Math.PI // 弧度转换为角度
          jointAngles[jointName] = angleDeg
        }
      })
      let gripperOpenness: number | undefined
      if (frame.io?.digital_output_0 !== undefined) {
        gripperOpenness = frame.io.digital_output_0 ? 0 : 1 // 0 关闭，1 打开
      }
      this.robotArm.animateMultipleJoints(jointAngles, duration, {
        onStart: () => {
          this.playCallbackOptions.onFrameUpdate?.(frame)
        },
        onComplete: () => {
          this.isProcessing = false
          this.lastProcessedFrame = frame
          this.playCallbackOptions.onFrameComplete?.(frame)
          log.debug(`帧 ${frame.id} 动画完成`)
        },
        onInterrupt: () => {
          this.isProcessing = false
        },
      })

      if (gripperOpenness !== undefined) {
        this.robotArm.animateGripperOpenness(gripperOpenness)
      }
      log.debug(`帧 ${frame.id} 动画开始，持续时间: ${duration.toFixed(3)}s`)
    } catch (error) {
      log.error(`执行帧 ${frame.id} 失败: ${error}`)
      this.isProcessing = false
      this.playCallbackOptions.onError?.(frame, error)
      this.stop()
    }
  }

  private calculateFrameDuration(currentFrame: FrameData, nextFrame?: FrameData): number {
    // 首帧默认 1 秒
    if (!this.lastProcessedFrame) return 1.0
    if (nextFrame) {
      const timeDiff = nextFrame.time - currentFrame.time
      return Math.max(0.1, timeDiff / 1000)
    }
    const timeDiff = currentFrame.time - this.lastProcessedFrame.time
    return Math.max(0.1, timeDiff / 1000)
  }

  stop(): void {
    if (this.status === 'idle') return
    this.status = 'stopped'
    this.isProcessing = false
    if (this.robotArm) {
      this.robotArm.stopAnimation()
      this.robotArm.stopAllJointAnimations()
    }
    this.stopAnimationLoop()
    this.clearQueue()
    log.info('已停止执行动作序列')
  }

  clearQueue(): void {
    this.frameQueue = []
  }

  getStatus(): PlayStatus {
    return this.status
  }
  getQueueLength(): number {
    return this.frameQueue.length
  }
  isProcessingQueue(): boolean {
    return this.isProcessing
  }
}
