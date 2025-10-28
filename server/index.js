import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import cors from 'cors'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

// 中间件
app.use(cors())
app.use(express.json())

// 存储连接的客户端
const clients = new Map()
let clientIdCounter = 0
// 跟踪每个客户端的序列推送定时器，便于停止和清理
const sequenceTimers = new Map()

// WebSocket连接处理
wss.on('connection', (ws, req) => {
  const clientId = ++clientIdCounter
  const clientInfo = {
    id: clientId,
    ws: ws,
    type: 'unknown', // 'simulator'
    connectedAt: new Date(),
    lastHeartbeat: Date.now(),
  }

  clients.set(clientId, clientInfo)
  console.log(`客户端 ${clientId} 已连接，当前连接数: ${clients.size}`)

  // 发送连接确认
  ws.send(
    JSON.stringify({
      type: 'connection',
      data: {
        clientId: clientId,
        message: '连接成功',
        timestamp: Date.now(),
      },
    })
  )

  // 消息处理
  ws.on('message', data => {
    try {
      const message = JSON.parse(data.toString())
      handleMessage(clientId, message)
    } catch (error) {
      console.error(`解析消息失败 (客户端 ${clientId}):`, error)
      sendError(ws, 'PARSE_ERROR', '消息格式错误')
    }
  })

  // 连接关闭处理
  ws.on('close', (code, reason) => {
    const wasDeleted = clients.delete(clientId)
    if (wasDeleted) {
      console.log(
        `客户端 ${clientId} 已断开连接 (code: ${code}, reason: ${reason})，当前连接数: ${clients.size}`
      )

      // 清理该客户端的序列定时器
      clearClientSequenceTimers(clientId)
    }
  })

  // 错误处理
  ws.on('error', error => {
    console.error(`客户端 ${clientId} 连接错误:`, error)
  })
})

// 消息处理函数
function handleMessage(clientId, message) {
  const client = clients.get(clientId)
  if (!client) return

  console.log(`收到消息 (客户端 ${clientId}):`, message.type)

  switch (message.type) {
    case 'register':
      handleRegister(clientId, message.data)
      break

    case 'heartbeat':
      handleHeartbeat(clientId)
      break

    case 'robot_state':
      handleRobotState(clientId, message.data)
      break

    case 'joint_control':
      handleJointControl(clientId, message.data)
      break

    case 'get_clients':
      sendClientsList(clientId)
      break

    case 'reset_robot':
      handleResetRobot(clientId)
      break

    case 'emergency_stop':
      handleEmergencyStop(clientId)
      break

    case 'test_sequence_request':
      handleTestSequenceRequest(clientId, message.data)
      break

    case 'stop_sequence_request':
      handleStopSequenceRequest(clientId, message.data)
      break

    default:
      sendError(client.ws, 'UNKNOWN_MESSAGE_TYPE', `未知消息类型: ${message.type}`)
  }
}

// 客户端注册
function handleRegister(clientId, data) {
  const client = clients.get(clientId)
  if (!client) return

  client.type = data.type || 'unknown'
  client.name = data.name || `客户端${clientId}`

  console.log(`客户端 ${clientId} 注册为: ${client.type} (${client.name})`)

  // 发送注册确认
  client.ws.send(
    JSON.stringify({
      type: 'register_success',
      data: {
        clientId: clientId,
        type: client.type,
        name: client.name,
      },
    })
  )
}

// 心跳处理
function handleHeartbeat(clientId) {
  const client = clients.get(clientId)
  if (!client) return

  client.lastHeartbeat = Date.now()

  // 发送心跳响应
  client.ws.send(
    JSON.stringify({
      type: 'heartbeat_response',
      data: { timestamp: Date.now() },
    })
  )
}

// 机器人状态更新
function handleRobotState(clientId, data) {
  console.log(`机器人状态更新 (客户端 ${clientId}):`, data)

  // 广播给所有客户端
  broadcast({
    type: 'robot_state_update',
    data: {
      sourceClientId: clientId,
      ...data,
    },
  })
}

// 关节控制命令
function handleJointControl(clientId, data) {
  console.log(`关节控制命令 (客户端 ${clientId}):`, data)
  const client = clients.get(clientId)
  client.ws.send(
    JSON.stringify({
      type: 'joint_control_command',
      data: {
        sourceClientId: clientId,
        ...data,
      },
    })
  )
}

// 处理测试序列请求
function handleTestSequenceRequest(clientId, data) {
  const client = clients.get(clientId)
  if (!client) return

  console.log(`收到测试序列请求 (客户端 ${clientId}):`, data)

  try {
    // 读取测试序列JSON文件
    const sequenceFilePath = join(__dirname, './actions/websocket_demo.json')
    const sequenceData = JSON.parse(readFileSync(sequenceFilePath, 'utf8'))
    const frames = sequenceData.frames || []

    if (frames.length === 0) {
      sendError(client.ws, 'EMPTY_SEQUENCE', '测试序列为空')
      return
    }

    console.log(`开始推送测试序列，共 ${frames.length} 帧`)

    // 发送序列开始消息
    client.ws.send(
      JSON.stringify({
        type: 'sequence_start',
        data: {
          meta: sequenceData.meta,
        },
      })
    )

  // 按时间戳有序推送帧数据
  pushSequenceFrames(clientId, frames)
  } catch (error) {
    console.error(`处理测试序列请求失败 (客户端 ${clientId}):`, error)
    sendError(client.ws, 'SEQUENCE_ERROR', `处理测试序列失败: ${error.message}`)
  }
}

// 处理停止序列请求
function handleStopSequenceRequest(clientId, _data) {
  const client = clients.get(clientId)
  if (!client) return

  console.log(`收到测试序列停止请求 (客户端 ${clientId})`)

  // 清理该客户端所有已调度的帧定时器
  clearClientSequenceTimers(clientId)

  // 通知客户端序列已停止
  if (client.ws.readyState === 1) {
    client.ws.send(
      JSON.stringify({
        type: 'sequence_stopped',
        data: { success: true, timestamp: Date.now(), reason: 'client_request' },
      })
    )
  }
}

// 推送序列帧
function pushSequenceFrames(clientId, frames) {
  const client = clients.get(clientId)
  if (!client) return

  function isConnected() {
    return clients.has(clientId) && client.ws.readyState === 1
  }

  // 清理此前的定时器，避免重复或泄漏
  clearClientSequenceTimers(clientId)
  const timers = []

  // 按帧的时间戳精确调度发送，避免高频轮询
  frames.forEach((frame, index) => {
    const delay = Math.max(0, frame.time)
    const t = setTimeout(() => {
      if (!isConnected()) {
        console.log(`客户端 ${clientId} 已断开，停止推送序列`)
        return
      }
      client.ws.send(
        JSON.stringify({
          type: 'sequence_frame',
          data: frame,
        })
      )
      console.log(`推送帧 ${frame.id} (${index + 1}/${frames.length}) - 时间: ${frame.time}ms`)
    }, delay)
    timers.push(t)
  })

  // 在最后一帧之后发送完成事件
  const lastFrameTime = frames[frames.length - 1].time
  const completeTimer = setTimeout(() => {
    if (!isConnected()) return
    client.ws.send(
      JSON.stringify({
        type: 'sequence_complete',
        data: { success: true },
      })
    )
    console.log(`测试序列推送完成`)
  }, Math.max(0, lastFrameTime))
  timers.push(completeTimer)

  // 保存该客户端的所有定时器以便后续清理
  sequenceTimers.set(clientId, timers)
}

// 发送客户端列表
function sendClientsList(clientId) {
  const client = clients.get(clientId)
  if (!client) return

  const clientsList = Array.from(clients.values()).map(c => ({
    id: c.id,
    type: c.type,
    name: c.name,
    connectedAt: c.connectedAt,
    lastHeartbeat: c.lastHeartbeat,
  }))

  client.ws.send(
    JSON.stringify({
      type: 'clients_list',
      data: { clients: clientsList },
    })
  )
}

// 处理重置机器人请求
function handleResetRobot(clientId) {
  const client = clients.get(clientId)
  if (!client) return
  console.log(`收到重置机器人请求 (客户端 ${clientId})`)
  client.ws.send(
    JSON.stringify({
      type: 'reset_robot',
      data: { sourceClientId: clientId },
    })
  )
}

// 处理紧急停止请求
function handleEmergencyStop(clientId) {
  const client = clients.get(clientId)
  if (!client) return
  console.log(`收到紧急停止请求 (客户端 ${clientId})`)
  client.ws.send(
    JSON.stringify({
      type: 'emergency_stop',
      data: { sourceClientId: clientId, timestamp: Date.now() },
    })
  )
}

// 广播消息给所有客户端
function broadcast(message, excludeClientId = null) {
  const messageStr = JSON.stringify(message)

  clients.forEach((client, clientId) => {
    if (clientId !== excludeClientId && client.ws.readyState === 1) {
      client.ws.send(messageStr)
    }
  })
}

// 发送错误消息
function sendError(ws, code, message) {
  if (ws.readyState === 1) {
    ws.send(
      JSON.stringify({
        type: 'error',
        data: { code, message, timestamp: Date.now() },
      })
    )
  }
}

// 清理某客户端的所有序列定时器
function clearClientSequenceTimers(clientId) {
  const timers = sequenceTimers.get(clientId)
  if (timers && Array.isArray(timers)) {
    timers.forEach(t => {
      try {
        clearTimeout(t)
      } catch (e) {
        // ignore
      }
    })
  }
  sequenceTimers.delete(clientId)
}

// 心跳检查定时器
setInterval(() => {
  const now = Date.now()
  const timeout = 30000 // 30秒超时

  clients.forEach((client, clientId) => {
    if (now - client.lastHeartbeat > timeout) {
      console.log(`客户端 ${clientId} 心跳超时，断开连接`)
      client.ws.terminate()
      clients.delete(clientId)
      console.log(`客户端 ${clientId} 已从列表中移除，当前连接数: ${clients.size}`)
      // 清理该客户端的序列定时器
      clearClientSequenceTimers(clientId)
    }
  })
}, 10000) // 每10秒检查一次

// REST API 端点
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    clients: clients.size,
    uptime: process.uptime(),
    timestamp: Date.now(),
  })
})

app.get('/api/clients', (req, res) => {
  const clientsList = Array.from(clients.values()).map(c => ({
    id: c.id,
    type: c.type,
    name: c.name,
    connectedAt: c.connectedAt,
    lastHeartbeat: c.lastHeartbeat,
  }))

  res.json({ clients: clientsList })
})

// 启动服务器
const PORT = 9000
server.listen(PORT, () => {
  console.log(`WebSocket服务器运行在端口 ${PORT}`)
  console.log(`WebSocket地址: ws://localhost:${PORT}`)
  console.log(`REST API地址: http://localhost:${PORT}/api`)
})
