import { WebSocketClient, type RobotStateData, type JointControlData } from './WebSocketClient'
import { RobotArm, type JointConfig } from './RobotArm'
import { TrajectoryVisualizer } from './TrajectoryVisualizer'
import { JointAnimationQueue, type FrameData } from './JointAnimationQueue'
import { log } from '../ui/Log'

export interface WebSocketConfig {
  url: string
  clientName: string
  enableStateSync: boolean
  stateSyncInterval: number
}

export class WebSocketManager {
  private client: WebSocketClient | null = null
  private robotArm: RobotArm | null = null
  private config: WebSocketConfig
  private stateSyncInterval: number | null = null
  private isStateSyncEnabled: boolean = false
  private onStateUpdateCallback?: (data: RobotStateData) => void
  private onConnectionStatusCallback?: (connected: boolean) => void
  private onRemoteCommandCallback?: (command: string, data: any) => void
  private onSequenceCallback?: (event: string, data: any) => void
  private animationQueue: JointAnimationQueue = new JointAnimationQueue()

  constructor(config: WebSocketConfig) {
    this.config = {
      ...config,
    }
  }

  // 初始化WebSocket连接
  async initialize(robotArm?: RobotArm): Promise<void> {
    if (robotArm) {
      this.robotArm = robotArm
      // 设置动画队列的机器人臂引用
      this.animationQueue.setRobotArm(robotArm)
    }

    this.client = new WebSocketClient(this.config.url, {
      id: 0, // 服务器会分配ID
      type: 'simulator',
      name: this.config.clientName,
    })

    // 设置事件监听器
    this.setupEventHandlers()
  }

  // 连接WebSocket
  async connect(): Promise<void> {
    if (!this.client) {
      throw new Error('WebSocket客户端未初始化')
    }

    try {
      await this.client.connect()
      console.log('WebSocket连接成功')

      if (this.config.enableStateSync) {
        this.startStateSync()
      }
    } catch (error) {
      console.error('WebSocket连接失败:', error)
      throw error
    }
  }

  // 断开连接
  disconnect(): void {
    this.stopStateSync()

    if (this.client) {
      this.client.disconnect()
    }
  }

  // 设置事件处理器
  private setupEventHandlers(): void {
    if (!this.client) return

    // 连接状态事件
    this.client.on('connected', () => {
      this.onConnectionStatusCallback?.(true)
    })

    this.client.on('disconnected', () => {
      this.onConnectionStatusCallback?.(false)
      this.stopStateSync()
    })

    this.client.on('error', _e => {})

    // 机器人控制命令
    this.client.on('joint_control_command', data => {
      log.info(`收到关节控制命令: ${JSON.stringify(data)}`)
      this.handleJointControlCommand(data)
    })

    // 重置机器人命令
    this.client.on('reset_robot', data => {
      log.info('收到重置机器人命令')
      if (this.robotArm) {
        this.robotArm.resetToDefault()
        console.log('机器人已重置')
      }
      this.onRemoteCommandCallback?.('reset_robot', data)
    })

    // 状态更新事件
    this.client.on('robot_state_update', data => {
      this.onStateUpdateCallback?.(data)
    })

    // 紧急停止
    this.client.on('emergency_stop', data => {
      log.warning(`收到紧急停止命令: ${JSON.stringify(data)}`)
      console.warn('收到紧急停止命令:', data)
      this.handleEmergencyStop()
    })

    // 客户端列表更新
    this.client.on('clients_list', data => {
      log.info(`收到客户端列表，共${data.clients?.length || 0}个客户端`)
      console.log('客户端列表:', data.clients)
    })

    // 序列事件
    this.client.on('sequence_start', data => {
      this.handleSequenceStart(data)
    })

    this.client.on('sequence_frame', data => {
      log.debug(`收到序列帧: ${data.id}`)
      this.handleSequenceFrame(data)
    })

    this.client.on('sequence_complete', data => {
      log.success(`序列推送完成！`)
      this.handleSequenceComplete(data)
    })

    // 序列停止
    this.client.on('sequence_stopped', data => {
      log.warning('服务端已停止序列推送')
      this.stopSequence()
      this.onSequenceCallback?.('stopped', data)
    })
  }

  // 处理关节控制命令
  private async handleJointControlCommand(data: JointControlData): Promise<void> {
    if (!this.robotArm) return

    console.log('执行关节控制命令:', data)

    try {
      const duration = data.duration || 0.5 // 默认0.5秒动画时间

      if (data.jointName && data.angle !== undefined) {
        this.robotArm.animateJointAngle(data.jointName, data.angle, duration)
      } else if (data.joints) {
        const jointAngles: Record<string, number> = {}
        data.joints.forEach(joint => {
          jointAngles[joint.name] = joint.angle
        })

        this.robotArm.animateMultipleJoints(jointAngles, duration)
      }

      if (data.gripperOpenness !== undefined) {
        this.robotArm.animateGripperOpenness(data.gripperOpenness, duration)
      }

      this.onRemoteCommandCallback?.('joint_control', data)
    } catch (error) {
      log.error(`执行关节控制命令失败: ${error}`)
      console.error('执行关节控制命令失败:', error)
    }
  }

  // 处理紧急停止
  private handleEmergencyStop(): void {
    if (this.robotArm) {
      log.warning('执行机器人紧急停止')

      // 停止所有动画（包括序列动画和关节动画）
      this.robotArm.stopAnimation()
      this.robotArm.stopAllJointAnimations()
      this.stopTestSequence()

      log.warning('所有动画已紧急停止')
      console.warn('机器人紧急停止')
    }

    this.onRemoteCommandCallback?.('emergency_stop', {})
  }

  // 开始状态同步
  private startStateSync(): void {
    if (!this.robotArm || this.stateSyncInterval) return

    this.isStateSyncEnabled = true
    this.stateSyncInterval = window.setInterval(() => {
      this.syncRobotState()
    }, this.config.stateSyncInterval)

    log.info(`状态同步已启动，间隔: ${this.config.stateSyncInterval}ms`)
  }

  // 停止状态同步
  private stopStateSync(): void {
    this.isStateSyncEnabled = false

    if (this.stateSyncInterval) {
      clearInterval(this.stateSyncInterval)
      this.stateSyncInterval = null
      log.info('状态同步已停止')
    }
  }

  // 同步机器人状态
  private syncRobotState(): void {
    if (!this.robotArm || !this.client || !this.isStateSyncEnabled) return

    const stateData = this.buildRobotStateData()

    console.log('同步机器人状态:', stateData)

    this.client.sendRobotState(stateData)
  }

  private buildRobotStateData(): RobotStateData {
    if (!this.robotArm || !this.client) {
      throw new Error('机器人臂或客户端实例未设置')
    }
    const now = Date.now()

    // 获取当前关节状态
    const joints = this.robotArm.getJointConfigs().map(config => ({
      name: config.name,
      angle: config.currentAngle,
    }))

    // 获取机械爪状态
    const gripperConfigs = this.robotArm.getGripperConfigs()
    const gripper = {
      openness: this.calculateGripperOpenness(gripperConfigs),
      isGripping: this.calculateGripperState(gripperConfigs),
    }

    // 获取末端执行器位置（如果可用）
    let endEffector
    const model = this.robotArm.getModel()
    if (model) {
      const position = TrajectoryVisualizer.getEndEffectorPosition(model)
      if (position) {
        endEffector = {
          position: [position.x, position.y, position.z] as [number, number, number],
          orientation: [0, 0, 0, 1] as [number, number, number, number], // 暂时使用默认四元数
        }
      }
    }

    const stateData: RobotStateData = {
      joints,
      gripper,
      endEffector,
      timestamp: now,
    }
    return stateData
  }

  // 计算机械爪开合程度
  private calculateGripperOpenness(gripperConfigs: JointConfig[]): number {
    const gripper1 = gripperConfigs.find(c => c.name === 'gripper1')
    if (!gripper1) return 0

    const range = gripper1.maxAngle - gripper1.minAngle
    const current = gripper1.currentAngle - gripper1.minAngle
    return Math.max(0, Math.min(1, current / range))
  }

  // 计算机械爪抓取状态
  private calculateGripperState(gripperConfigs: JointConfig[]): boolean {
    const openness = this.calculateGripperOpenness(gripperConfigs)
    return openness < 0.3 // 开合程度小于30%认为是抓取状态
  }

  // 处理序列开始
  private handleSequenceStart(data: any): void {
    this.onSequenceCallback?.('start', data)
    this.animationQueue.startSequence({
      onFrameUpdate: frame => {
        this.onSequenceCallback?.('frame_update', { frame })
      },
      onFrameComplete: frame => {
        this.onSequenceCallback?.('playback_complete', { frame })
      },
      onError: (frame, error) => {
        this.onSequenceCallback?.('error', { error, frame })
      },
    })
  }

  // 处理序列帧
  private handleSequenceFrame(frameData: FrameData): void {
    this.animationQueue.enqueueFrame(frameData)
  }

  // 处理序列完成
  private handleSequenceComplete(data: any): void {
    this.onSequenceCallback?.('complete', data)
  }

  // 手动发送机器人状态
  sendCurrentState(): void {
    if (this.robotArm && this.client) {
      log.info('发送当前机器人状态到服务器')
      const stateData = this.buildRobotStateData()
      console.log('发送机器人状态:', stateData)
      this.client.sendRobotState(stateData)
    }
  }

  // 发送关节控制命令
  sendJointControl(controlData: JointControlData): void {
    if (this.client) {
      log.info(`发送关节控制命令: ${JSON.stringify(controlData)}`)
      this.client.sendJointControl(controlData)
    }
  }

  // 请求客户端列表
  requestClientsList(): void {
    if (this.client) {
      log.info('发送客户端列表请求')
      this.client.requestClientsList()
    }
  }

  // 紧急停止
  emergencyStop(): void {
    if (this.client) {
      log.warning('发送紧急停止命令')
      this.client.emergencyStop()
    }
  }

  // 重置机器人
  resetRobot(): void {
    if (this.client) {
      log.info('发送机器人重置命令')
      this.client.resetRobot()
    }
  }

  // 请求测试动作序列
  requestTestSequence(): void {
    if (this.client) {
      log.info('请求测试动作序列')
      this.client.requestTestSequence()
    }
  }

  // 停止序列
  stopSequence(): void {
    this.animationQueue.stop()
  }

  // 停止测试序列
  stopTestSequence(): void {
    if (this.client) {
      log.info('发送停止测试序列请求')
      this.client.stopTestSequence()
    }
    this.stopSequence()
  }

  // 获取动画队列状态
  getAnimationQueueStatus(): string {
    return this.animationQueue.getStatus()
  }

  // 获取连接状态
  isConnected(): boolean {
    return this.client?.isWebSocketConnected() || false
  }

  // 设置回调函数
  onStateUpdate(callback: (data: RobotStateData) => void): void {
    this.onStateUpdateCallback = callback
  }

  onConnectionStatus(callback: (connected: boolean) => void): void {
    this.onConnectionStatusCallback = callback
  }

  onRemoteCommand(callback: (command: string, data: any) => void): void {
    this.onRemoteCommandCallback = callback
  }

  onSequence(callback: (event: string, data: any) => void): void {
    this.onSequenceCallback = callback
  }

  // 更新配置
  updateConfig(newConfig: Partial<WebSocketConfig>): void {
    const oldConfig = { ...this.config }
    this.config = { ...this.config, ...newConfig }

    log.info(`WebSocket配置已更新: ${JSON.stringify(newConfig)}`)

    // 如果状态同步间隔改变，重启状态同步
    if (newConfig.stateSyncInterval && this.isStateSyncEnabled) {
      log.info(
        `状态同步间隔从${oldConfig.stateSyncInterval}ms更新为${newConfig.stateSyncInterval}ms`
      )
      this.stopStateSync()
      this.startStateSync()
    }

    // 如果状态同步开关改变
    if (newConfig.enableStateSync !== undefined) {
      if (newConfig.enableStateSync && !this.isStateSyncEnabled) {
        this.startStateSync()
      } else if (!newConfig.enableStateSync && this.isStateSyncEnabled) {
        this.stopStateSync()
      }
    }
  }

  // 获取当前配置
  getConfig(): WebSocketConfig {
    return { ...this.config }
  }
}
