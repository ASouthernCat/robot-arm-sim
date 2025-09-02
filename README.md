# 机械臂仿真 Demo

基于 Three.js + TypeScript 的机械臂仿真项目，用于demo展示与学习机器人仿真相关知识。

![机械臂仿真效果预览](/public/preview.png)

## 技术栈

- **前端**: Three.js + TypeScript
- **物理引擎**: Rapier3D
- **UI控制**: Tweakpane + Tailwind CSS
- **动画**: GSAP
- **性能监控**: Stats.js + WebGLInfo (`renderer.info`)
- **模型**: Blender + [Sketchfab](https://skfb.ly/oOSqr)

## 功能特性

### 已完成

- ✅ 基础项目架构搭建
- ✅ Three.js 场景初始化
- ✅ 机械臂模型加载
- ✅ 控制面板 UI
- ✅ 性能监控面板
- ✅ 关节运动控制
- ✅ 视角切换

### 待开发

- 🔄 动作录制与回放
- 🔄 动作预设库
- 🔄 轨迹可视化
- 🔄 物理仿真
- 🔄 WebSocket 实时通信

## ✅ run

```bash
npm install

npm run dev
```
