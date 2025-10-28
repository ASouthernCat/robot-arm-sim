import { log } from '../ui/Log'

export interface WebSocketMessage {
  type: string
  data: any
}

export interface ClientInfo {
  id: number
  type: 'simulator'
  name: string
  connectedAt?: Date
  lastHeartbeat?: number
}

export interface RobotStateData {
  joints: Array<{
    name: string
    angle: number // 度数
    velocity?: number
  }>
  gripper?: {
    openness: number // 0-1
    isGripping?: boolean
  }
  endEffector?: {
    position: [number, number, number]
    orientation: [number, number, number, number] // 四元数
  }
  timestamp: number
}

export interface JointControlData {
  jointName?: string
  angle?: number
  joints?: Array<{ name: string; angle: number }>
  gripperOpenness?: number
  duration?: number
}

export type WebSocketEventHandler = (data: any) => void

export class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private clientInfo: ClientInfo
  private heartbeatInterval: number | null = null
  private eventHandlers: Map<string, WebSocketEventHandler[]> = new Map()
  private isConnected: boolean = false
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 3
  private reconnectDelay: number = 2000
  private isReconnecting: boolean = false
  private isManualDisconnect: boolean = false

  constructor(url: string, clientInfo: ClientInfo) {
    this.url = url
    this.clientInfo = clientInfo
  }

  // 连接WebSocket
  async connect(): Promise<void> {
    // 如果已有连接，先清理
    if (this.ws) {
      this.cleanupConnection()
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url)

        this.ws.onopen = () => {
          log.success('WebSocket连接已建立')
          console.log('WebSocket连接已建立')
          this.isConnected = true
          this.resetReconnectState()

          // 注册客户端
          this.register()

          // 启动心跳
          this.startHeartbeat()

          this.emit('connected', { clientInfo: this.clientInfo })
          resolve()
        }

        this.ws.onmessage = event => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data)
            this.handleMessage(message)
          } catch (error) {
            log.error(`解析WebSocket消息失败: ${error}`)
            console.error('解析WebSocket消息失败:', error)
          }
        }

        this.ws.onclose = event => {
          log.warning(`WebSocket连接断开: ${event.code} ${event.reason}`)
          console.log('WebSocket连接已关闭:', event.code, event.reason)
          this.isConnected = false
          this.stopHeartbeat()

          // 重置重连标记，确保失败后可以继续下一次重连尝试
          this.isReconnecting = false

          this.emit('disconnected', { code: event.code, reason: event.reason })

          // 如果不是手动断开且未达到最大重连次数，则尝试重连
          if (!this.isManualDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect()
          } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            log.error('已达到最大重连次数，停止重连')
            console.error('已达到最大重连次数，停止重连')
            this.emit('reconnect_failed', { attempts: this.reconnectAttempts })
          }
        }

        this.ws.onerror = error => {
          log.error(`WebSocket错误: ${error}`)
          console.error('WebSocket连接错误:', error)
          this.emit('error', { error })
          reject(error)
        }
      } catch (error) {
        console.error('创建WebSocket连接失败:', error)
        reject(error)
      }
    })
  }

  // 断开连接
  disconnect(): void {
    this.isManualDisconnect = true
    this.isReconnecting = false
    this.cleanupConnection()
  }

  // 清理连接
  private cleanupConnection(): void {
    this.stopHeartbeat()
    this.isConnected = false

    if (this.ws) {
      // 如果连接还在打开状态，则关闭
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, '客户端主动断开')
      }

      this.ws = null
    }
  }

  // 发送消息
  send(type: string, data: any): void {
    if (!this.isConnected || !this.ws) {
      console.warn('WebSocket未连接，无法发送消息')
      return
    }

    const message: WebSocketMessage = { type, data }

    try {
      this.ws.send(JSON.stringify(message))
    } catch (error) {
      log.error(`发送WebSocket消息失败: ${error}`)
      console.error('发送WebSocket消息失败:', error)
    }
  }

  // 注册客户端
  private register(): void {
    this.send('register', {
      type: this.clientInfo.type,
      name: this.clientInfo.name,
    })
  }

  // 处理接收到的消息
  private handleMessage(message: WebSocketMessage): void {
    if (message.type !== 'robot_state_update') {
      // 对非状态更新消息进行日志记录
      log.info(`收到WebSocket消息: ${message.type}`)
    }
    console.log('收到WebSocket消息:', message.type)

    switch (message.type) {
      case 'connection':
        this.clientInfo.id = message.data.clientId
        break

      case 'register_success':
        log.success(`客户端注册成功: ${JSON.stringify(message.data)}`)
        console.log('客户端注册成功:', message.data)
        break

      case 'heartbeat_response':
        // 心跳响应，无需特殊处理
        break

      case 'error':
        log.error(`服务器错误: ${JSON.stringify(message.data)}`)
        console.error('服务器错误:', message.data)
        this.emit('error', message.data)
        break

      default:
        // 触发对应的事件处理器
        this.emit(message.type, message.data)
        break
    }
  }

  // 启动心跳
  private startHeartbeat(): void {
    this.stopHeartbeat()

    this.heartbeatInterval = window.setInterval(() => {
      if (this.isConnected) {
        this.send('heartbeat', { timestamp: Date.now() })
      }
    }, 15000) // 每15秒发送一次心跳
  }

  // 停止心跳
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  // 尝试重连
  private attemptReconnect(): void {
    if (this.isReconnecting || this.isManualDisconnect) return

    this.isReconnecting = true
    this.reconnectAttempts++

    log.warning(`尝试WebSocket重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
    console.log(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)

    setTimeout(() => {
      this.connect().catch(error => {
        console.error(`重连失败:`, error)
        // 连接失败后，onclose事件会被触发，继续重连逻辑
      })
    }, this.reconnectDelay)
  }

  // 重置重连状态
  private resetReconnectState(): void {
    this.reconnectAttempts = 0
    this.isManualDisconnect = false
    this.isReconnecting = false
  }

  // 事件监听
  on(event: string, handler: WebSocketEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, [])
    }
    this.eventHandlers.get(event)!.push(handler)
  }

  // 移除事件监听
  off(event: string, handler?: WebSocketEventHandler): void {
    if (!this.eventHandlers.has(event)) return

    if (handler) {
      const handlers = this.eventHandlers.get(event)!
      const index = handlers.indexOf(handler)
      if (index > -1) {
        handlers.splice(index, 1)
      }
    } else {
      this.eventHandlers.delete(event)
    }
  }

  // 触发事件
  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data)
        } catch (error) {
          log.error(`WebSocket事件处理器执行失败 (${event}): ${error}`)
          console.error(`事件处理器执行失败 (${event}):`, error)
        }
      })
    }
  }

  // 获取连接状态
  isWebSocketConnected(): boolean {
    return this.isConnected
  }

  // 获取客户端信息
  getClientInfo(): ClientInfo {
    return { ...this.clientInfo }
  }

  // 发送机器人状态
  sendRobotState(stateData: RobotStateData): void {
    this.send('robot_state', stateData)
  }

  // 发送关节控制命令
  sendJointControl(controlData: JointControlData): void {
    this.send('joint_control', controlData)
  }

  // 请求客户端列表
  requestClientsList(): void {
    this.send('get_clients', { sourceClientId: this.clientInfo.id })
  }

  // 紧急停止
  emergencyStop(): void {
    this.send('emergency_stop', { sourceClientId: this.clientInfo.id, timestamp: Date.now() })
  }

  // 重置机器人
  resetRobot(): void {
    this.send('reset_robot', { sourceClientId: this.clientInfo.id })
  }

  // 请求测试动作序列
  requestTestSequence(): void {
    this.send('test_sequence_request', {
      clientId: this.clientInfo.id,
    })
  }

  // 停止测试动作序列
  stopTestSequence(): void {
    this.send('stop_sequence_request', {
      clientId: this.clientInfo.id,
    })
  }

  // 手动重连（重置重连计数）
  async reconnect(): Promise<void> {
    this.resetReconnectState()
    return this.connect()
  }
}
