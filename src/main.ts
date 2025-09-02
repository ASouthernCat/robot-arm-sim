import './styles/main.css'
import { Scene } from './core/Scene'
import { RobotArm } from './core/RobotArm'
import { ControlPanel } from './ui/ControlPanel'

class RobotArmSimulation {
  private scene!: Scene
  private robotArm!: RobotArm
  private controlPanel!: ControlPanel

  constructor() {
    this.initialize()
  }

  private async initialize(): Promise<void> {
    try {
      // 获取容器
      const container = document.getElementById('app')
      if (!container) {
        throw new Error('找不到应用容器')
      }

      // 创建场景
      this.scene = new Scene(container)

      // 创建机械臂
      this.robotArm = new RobotArm(this.scene.getScene())

      // 加载机械臂模型
      await this.robotArm.loadModel('/models/arm.glb')

      // 创建控制面板
      this.controlPanel = ControlPanel.getInstance()
      this.controlPanel.bindScene(this.scene)
      this.controlPanel.bindRobotArm(this.robotArm)

      // 开始渲染循环
      this.update()

      console.log('机械臂仿真初始化完成')
    } catch (error) {
      console.error('初始化失败:', error)
      this.showError('初始化失败，请检查控制台获取详细信息')
    }
  }

  private update(): void {
    requestAnimationFrame(this.update.bind(this))
    this.scene.update()
    this.robotArm.update()
  }

  private showError(message: string): void {
    const errorDiv = document.createElement('div')
    errorDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #ff4444;
      color: white;
      padding: 20px;
      border-radius: 8px;
      font-family: Arial, sans-serif;
      z-index: 10000;
    `
    errorDiv.textContent = message
    document.body.appendChild(errorDiv)
  }
}

// 启动应用
new RobotArmSimulation()
