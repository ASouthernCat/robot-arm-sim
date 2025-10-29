# 机械臂仿真可视化 Demo

基于 Three.js + WebSocket + GSAP 的机械臂仿真可视化项目，用于demo展示与学习机器人仿真相关知识。

![机械臂仿真效果预览](./preview.png)

## 技术栈

- **前端**: Three.js + TypeScript
- **UI控制**: Tweakpane
- **补间动画**: GSAP
- **性能监控**: Stats.js
- **模型**: Blender + [Sketchfab](https://skfb.ly/oOSqr)
- **WebSocket服务**: Node.js + Express + WebSocket

## 功能特性

- ✅ 基础项目架构搭建
- ✅ Three.js 场景初始化
- ✅ 机械臂模型加载
- ✅ 控制面板 UI
- ✅ 性能监控面板
- ✅ 关节运动控制
- ✅ 视角切换
- ✅ 动作预设库
- ✅ 文件上传
- ✅ 轨迹可视化
- ✅ WebSocket 实时通信
- 🔄 ~~动作录制与回放~~
- 🔄 ~~物理仿真（任务场景、碰撞检测）~~

> **💡物理仿真**  
> 考虑到物理仿真的复杂度及本 demo 以“可视化”为核心的定位，物理仿真可采用以下两种方案:
>
> 1. 通过 WebAssembly 集成高性能物理引擎（如 MuJoCo、PhysX）在本地完成实时计算；
> 2. 将复杂训练放在远端服务器/边缘节点运行，前端仅通过 WebSocket 接收计算结果并做姿态可视化展示。

### 序列帧结构

```js
export interface JSONKeyFrame {
  id: number // 关键帧id标识
  time: number // 时间戳（毫秒）
  joints: number[] // 弧度
  cartesian?: {
    position: [number, number, number] // 末端执行器位置
    orientation: [number, number, number, number] // 四元数 [x, y, z, w]
  } | null
  io?: {
    digital_output_0?: boolean // 机械爪状态，true为闭合，false为张开
  }
}
```

## ✅ run

```bash
npm install

npm run dev

# 启动WebSocket服务
npm run server
```

## buy me a coffee

创作不易，多多支持~  
你的支持是我创作的最大动力！

![buy me a coffee](./qrpay.jpg)
