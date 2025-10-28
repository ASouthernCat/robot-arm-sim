import { Pane, type FolderApi } from 'tweakpane'
import { WebSocketManager, type WebSocketConfig } from '../core/WebSocketManager'
import { RobotArm } from '../core/RobotArm'
import { log } from './Log'

export interface WebSocketPanelConfig {
  title?: string
  expanded?: boolean
}

export class WebSocketPanel {
  private pane: FolderApi
  private robotArm: RobotArm
  private webSocketManager: WebSocketManager | null = null
  private statusUpdateInterval: number | null = null
  private connectButton: any = null
  private disconnectButton: any = null
  private reconnectButton: any = null
  private config: WebSocketConfig = {
    url: 'ws://localhost:9000',
    clientName: '机械臂仿真器',
    enableStateSync: true,
    stateSyncInterval: 100,
  }

  private connectionStatus = {
    connected: false,
    lastUpdate: '未连接',
  }

  private controls = {
    // 连接配置
    serverUrl: this.config.url,
    clientName: this.config.clientName,
    enableStateSync: this.config.enableStateSync,
    stateSyncInterval: this.config.stateSyncInterval,

    // 连接控制
    connect: () => this.handleConnect(),
    disconnect: () => this.handleDisconnect(),
    reconnect: () => this.handleReconnect(),

    // 状态显示
    connectionStatus: '未连接',

    // 远程控制
    sendCurrentState: () => this.sendCurrentState(),
    requestClientsList: () => this.requestClientsList(),
    emergencyStop: () => this.emergencyStop(),
    resetRobot: () => this.resetRobot(),

    // 测试命令
    testJointControl: () => this.testJointControl(),
    testActionSequence: () => this.testActionSequence(),
    stopTestSequence: () => this.stopTestSequence(),

    // 测试序列状态
    sequenceStatus: '未运行',
    currentFrameId: '--',
  }

  // 序列执行状态跟踪
  private sequenceState = {
    isCompleted: false,
    isStopped: false,
    lastFrameId: -1,
  }

  constructor(parentPane: Pane, robotArm: RobotArm, config: WebSocketPanelConfig = {}) {
    this.robotArm = robotArm

    this.pane = parentPane.addFolder({
      title: config.title || 'WebSocket 通信',
      expanded: config.expanded !== false,
    })

    this.setupUI()
    this.updateConnectionStatus()
    this.startStatusMonitoring()

    // 初始化按钮状态
    this.updateButtonStates(false)
  }

  private setupUI(): void {
    // 连接配置组
    const configFolder = this.pane.addFolder({
      title: '连接配置',
      expanded: true,
    })

    configFolder
      .addBinding(this.controls, 'serverUrl', {
        label: '服务器地址',
      })
      .on('change', ev => {
        this.config.url = ev.value
      })

    configFolder
      .addBinding(this.controls, 'clientName', {
        label: '客户端名称',
      })
      .on('change', ev => {
        this.config.clientName = ev.value
      })

    configFolder
      .addBinding(this.controls, 'enableStateSync', {
        label: '状态同步',
      })
      .on('change', ev => {
        this.config.enableStateSync = ev.value
        if (this.webSocketManager) {
          this.webSocketManager.updateConfig({ enableStateSync: ev.value })
          console.log(`状态同步已${ev.value ? '启用' : '禁用'}`)
        }
      })

    configFolder
      .addBinding(this.controls, 'stateSyncInterval', {
        label: '同步间隔(ms)',
        min: 50,
        max: 1000,
        step: 50,
      })
      .on('change', ev => {
        this.config.stateSyncInterval = ev.value
        if (this.webSocketManager) {
          this.webSocketManager.updateConfig({ stateSyncInterval: ev.value })
          console.log(`同步间隔已更新为: ${ev.value}ms`)
        }
      })

    // 连接控制组
    const connectionFolder = this.pane.addFolder({
      title: '连接控制',
      expanded: true,
    })

    this.connectButton = connectionFolder
      .addButton({
        title: '连接',
      })
      .on('click', this.controls.connect)

    this.disconnectButton = connectionFolder
      .addButton({
        title: '断开连接',
      })
      .on('click', this.controls.disconnect)

    this.reconnectButton = connectionFolder
      .addButton({
        title: '重连',
      })
      .on('click', this.controls.reconnect)

    connectionFolder.addBinding(this.controls, 'connectionStatus', {
      label: '连接状态',
      readonly: true,
    })

    // 远程控制组
    const remoteFolder = this.pane.addFolder({
      title: '远程控制',
      expanded: false,
    })

    remoteFolder
      .addButton({
        title: '发送当前状态',
      })
      .on('click', this.controls.sendCurrentState)

    remoteFolder
      .addButton({
        title: '获取客户端列表',
      })
      .on('click', this.controls.requestClientsList)

    remoteFolder
      .addButton({
        title: '紧急停止',
      })
      .on('click', this.controls.emergencyStop)

    remoteFolder
      .addButton({
        title: '重置机器人',
      })
      .on('click', this.controls.resetRobot)

    // 测试命令组
    const testFolder = this.pane.addFolder({
      title: '测试命令',
      expanded: false,
    })

    testFolder
      .addButton({
        title: '测试关节控制（随机角度值）',
      })
      .on('click', this.controls.testJointControl)

    testFolder
      .addButton({
        title: '开始测试序列',
      })
      .on('click', this.controls.testActionSequence)

    testFolder
      .addButton({
        title: '停止测试序列',
      })
      .on('click', this.controls.stopTestSequence)

    testFolder.addBinding(this.controls, 'sequenceStatus', {
      label: '序列状态',
      readonly: true,
    })

    testFolder.addBinding(this.controls, 'currentFrameId', {
      label: '当前帧ID',
      readonly: true,
    })
  }

  private async handleConnect(): Promise<void> {
    // 检查是否已经连接
    if (this.robotArm.isWebSocketConnected()) {
      log.warning('WebSocket已经连接，无需重复连接')
      console.warn('WebSocket已经连接')
      alert('WebSocket已经连接，无需重复连接')
      return
    }

    try {
      this.connectButton.title = '连接中...'
      this.connectButton.disabled = true
      this.reconnectButton.disabled = true

      log.info(`尝试连接WebSocket服务器: ${this.controls.serverUrl}`)

      // 更新配置
      this.config.url = this.controls.serverUrl
      this.config.clientName = this.controls.clientName
      this.config.enableStateSync = this.controls.enableStateSync
      this.config.stateSyncInterval = this.controls.stateSyncInterval

      // 初始化WebSocket
      await this.robotArm.initializeWebSocket(this.config)

      // 连接
      await this.robotArm.connectWebSocket()

      this.webSocketManager = this.robotArm.getWebSocketManager()
      this.setupWebSocketCallbacks()
    } catch (error) {
      console.error('WebSocket连接失败:', error)
      alert(`连接失败！`)
    }
  }

  private handleDisconnect(): void {
    try {
      log.info('用户主动断开WebSocket连接')
      this.robotArm.disconnectWebSocket()
      this.webSocketManager = null
      this.updateConnectionStatus()
      console.log('WebSocket已断开连接')
    } catch (error) {
      log.error(`断开WebSocket连接失败: ${error}`)
      console.error('断开连接失败:', error)
    }
  }

  private async handleReconnect(): Promise<void> {
    try {
      log.info('用户手动重连WebSocket')

      // 先断开现有连接
      if (this.robotArm.isWebSocketConnected()) {
        this.robotArm.disconnectWebSocket()
        this.webSocketManager = null
      }

      // 更新配置
      this.config.url = this.controls.serverUrl
      this.config.clientName = this.controls.clientName
      this.config.enableStateSync = this.controls.enableStateSync
      this.config.stateSyncInterval = this.controls.stateSyncInterval

      // 初始化并重连
      await this.robotArm.initializeWebSocket(this.config)

      // 使用重连方法（重置重连计数）
      const wsManager = this.robotArm.getWebSocketManager()
      if (wsManager) {
        const client = (wsManager as any).client
        if (client && client.reconnect) {
          await client.reconnect()
        } else {
          await this.robotArm.connectWebSocket()
        }
      }

      this.webSocketManager = this.robotArm.getWebSocketManager()
      this.setupWebSocketCallbacks()

      console.log('WebSocket重连成功')
    } catch (error) {
      log.error(`WebSocket重连失败: ${error}`)
      console.error('WebSocket重连失败:', error)
      alert(`重连失败: ${error}`)
    }
  }

  private setupWebSocketCallbacks(): void {
    if (!this.webSocketManager) return

    this.webSocketManager.onConnectionStatus(() => {
      this.updateConnectionStatus()
    })

    this.webSocketManager.onStateUpdate(data => {
      console.log('收到状态更新:', data)
    })

    this.webSocketManager.onSequence((event: string, data: any) => {
      this.handleSequenceEvent(event, data)
    })
  }

  private updateConnectionStatus(): void {
    const connected = this.robotArm.isWebSocketConnected()

    this.controls.connectionStatus = connected ? '已连接' : '未连接'
    this.connectionStatus.lastUpdate = new Date().toLocaleTimeString()

    // 更新按钮状态
    this.updateButtonStates(connected)

    // 刷新UI显示
    this.pane.refresh()
  }

  private updateButtonStates(connected: boolean): void {
    if (this.connectButton && this.disconnectButton && this.reconnectButton) {
      // 已连接时禁用连接和重连按钮，启用断开按钮
      this.connectButton.title = '连接'
      this.connectButton.disabled = connected
      this.disconnectButton.disabled = !connected
      this.reconnectButton.disabled = connected
    }
  }

  private sendCurrentState(): void {
    if (this.robotArm.isWebSocketConnected() && this.webSocketManager) {
      this.webSocketManager.sendCurrentState()

      // 更新UI状态显示
      this.updateConnectionStatus()
    } else {
      log.warning('WebSocket未连接，无法发送状态')
      console.warn('WebSocket未连接，无法发送状态')
      alert('WebSocket未连接')
    }
  }

  private requestClientsList(): void {
    if (this.webSocketManager) {
      this.webSocketManager.requestClientsList()
    } else {
      log.warning('WebSocket未连接，无法请求客户端列表')
      alert('WebSocket未连接')
    }
  }

  private emergencyStop(): void {
    if (this.webSocketManager) {
      this.webSocketManager.emergencyStop()
      console.log('已发送紧急停止命令')
    } else {
      log.error('WebSocket未连接，无法发送紧急停止命令')
      alert('WebSocket未连接')
    }
  }

  private resetRobot(): void {
    if (this.webSocketManager) {
      this.webSocketManager.resetRobot()
      console.log('已发送重置机器人命令')
    } else {
      log.warning('WebSocket未连接，无法发送重置命令')
      alert('WebSocket未连接')
    }
  }

  private testJointControl(): void {
    if (this.webSocketManager) {
      const testAngle = Math.random() * 120 - 60 // -60到60度随机角度

      // 发送测试关节控制命令
      this.webSocketManager.sendJointControl({
        jointName: 'base1',
        angle: testAngle,
        duration: 1.0,
      })
    } else {
      log.warning('WebSocket未连接，无法发送测试命令')
      alert('WebSocket未连接')
    }
  }

  private testActionSequence(): void {
    if (this.webSocketManager) {
      this.resetSequenceState()
      this.controls.sequenceStatus = '请求中...'
      this.controls.currentFrameId = '--'
      this.pane.refresh()

      this.webSocketManager.requestTestSequence()
    } else {
      log.warning('WebSocket未连接，无法启动测试序列')
      alert('WebSocket未连接')
    }
  }

  private stopTestSequence(): void {
    if (this.webSocketManager) {
      this.webSocketManager.stopTestSequence()
      this.sequenceState.isStopped = true
      this.controls.sequenceStatus = '已停止'
      this.controls.currentFrameId = '--'
      this.pane.refresh()
    } else {
      log.warning('WebSocket未连接')
      alert('WebSocket未连接')
    }
  }

  private handleSequenceEvent(event: string, data: any): void {
    switch (event) {
      case 'start':
        this.resetSequenceState()
        this.controls.sequenceStatus = '接收中'
        this.controls.currentFrameId = '--'
        break

      case 'frame_update':
        this.sequenceState.lastFrameId = data.frame.id

        if (!this.sequenceState.isCompleted && !this.sequenceState.isStopped) {
          this.controls.sequenceStatus = '执行中'
          this.controls.currentFrameId = String(data.frame.id)
        }
        break

      case 'playback_complete':
        if (this.sequenceState.isCompleted) {
          this.controls.sequenceStatus = '执行完毕'
          this.controls.currentFrameId = '--'
          break
        }
        this.controls.sequenceStatus = '已完成'
        break

      case 'error':
        this.sequenceState.isStopped = true
        this.controls.sequenceStatus = `执行错误@帧${data.frame.id}`
        break
      case 'complete':
        this.sequenceState.isCompleted = true
        break

      case 'stopped':
        this.sequenceState.isStopped = true
        this.controls.sequenceStatus = '已停止'
        this.controls.currentFrameId = '--'
        break

      default:
        console.log(`序列事件: ${event}`, data)
    }

    // 刷新UI显示
    this.pane.refresh()
  }

  // 获取WebSocket管理器
  getWebSocketManager(): WebSocketManager | null {
    return this.webSocketManager
  }

  // 开始状态监控
  private startStatusMonitoring(): void {
    // 每秒更新一次连接状态显示
    this.statusUpdateInterval = window.setInterval(() => {
      this.updateConnectionStatus()
    }, 1000)
  }

  // 停止状态监控
  private stopStatusMonitoring(): void {
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval)
      this.statusUpdateInterval = null
    }
  }

  // 重置序列状态
  private resetSequenceState(): void {
    this.sequenceState.isCompleted = false
    this.sequenceState.isStopped = false
    this.sequenceState.lastFrameId = -1
  }

  // 销毁面板
  dispose(): void {
    this.stopStatusMonitoring()
    if (this.webSocketManager) {
      this.robotArm.disconnectWebSocket()
    }
  }
}
