import { Pane } from 'tweakpane'
import { RobotArm } from '../core/RobotArm'
import { Scene } from '../core/Scene'
import gsap from 'gsap'
import { SceneConfig } from '@/config/Scene'
import * as THREE from 'three'
import type { BindingApi, ButtonApi } from '@tweakpane/core'

export class ControlPanel {
  private pane: Pane
  private robotArm: RobotArm | null = null
  private scene: Scene | null = null
  private jointControls: Map<string, BindingApi> = new Map()
  private static instance: ControlPanel | null = null
  private progressBinding: BindingApi | null = null
  private stateBinding: BindingApi | null = null
  private resetButton: ButtonApi | null = null
  private playButton: ButtonApi | null = null
  private pauseButton: ButtonApi | null = null
  private stopButton: ButtonApi | null = null
  private animationControls: {
    actionProgress: number
    currentFrameId: number
    isPlaying: boolean
    isPaused: boolean
    selectedAction: string
    gripperState: boolean
    isDragActionProgress: boolean
  } = {
    actionProgress: 0,
    currentFrameId: 0,
    isPlaying: false,
    isPaused: false,
    selectedAction: 'pick_and_place.json',
    gripperState: false,
    isDragActionProgress: false,
  }

  private constructor() {
    this.pane = new Pane({
      title: 'Robot Arm Simulator',
    })
  }

  public static getInstance(): ControlPanel {
    if (!ControlPanel.instance) {
      ControlPanel.instance = new ControlPanel()
    }
    return ControlPanel.instance
  }

  // 销毁实例，清理资源
  public static destroyInstance(): void {
    if (ControlPanel.instance) {
      ControlPanel.instance.pane.dispose()
      ControlPanel.instance = null
    }
  }

  getPane(): Pane {
    return this.pane
  }

  // 绑定 Scene
  public bindScene(scene: Scene): void {
    this.scene = scene
    // 添加相机控制
    const cameraFolder = this.pane.addFolder({
      title: 'Camera Control',
    })

    const cameraConfig = { view: 'DEFAULT' }
    const cameraBinding = cameraFolder.addBinding(cameraConfig, 'view', {
      view: 'list',
      label: '视角',
      options: [
        { text: 'default', value: 'DEFAULT' },
        { text: 'front', value: 'FRONT' },
        { text: 'top', value: 'TOP' },
        { text: 'side', value: 'SIDE' },
      ],
    })

    cameraBinding.on('change', ev => {
      this.handleCameraViewChange(ev.value)
    })
  }

  // 处理相机视角变化
  private handleCameraViewChange(view: string): void {
    if (!this.scene) return

    switch (view) {
      case 'DEFAULT':
        this.setMainView()
        break
      case 'FRONT':
        this.setFrontView()
        break
      case 'TOP':
        this.setTopView()
        break
      case 'SIDE':
        this.setSideView()
        break
    }
  }

  private setFrontView(): void {
    this.moveCamera(new THREE.Vector3(0, 1.5, 5), SceneConfig.controls.defaultTarget)
  }

  private setMainView(): void {
    this.moveCamera(SceneConfig.camera.defaultPos, SceneConfig.controls.defaultTarget)
  }

  private setTopView(): void {
    const epsilon = 0.0001 // 极小偏移量，避免 phi=0 奇点
    this.moveCamera(new THREE.Vector3(0, 10, epsilon), SceneConfig.controls.defaultTarget)
  }

  private setSideView(): void {
    this.moveCamera(new THREE.Vector3(5, 1.5, 0), SceneConfig.controls.defaultTarget)
  }

  private moveCamera(position: THREE.Vector3, target: THREE.Vector3): void {
    const camera = this.scene?.getCamera()
    const controls = this.scene?.getControls()
    if (camera && controls) {
      gsap.killTweensOf(camera)
      gsap.killTweensOf(controls)
      controls.enabled = false
      gsap.to(camera.position, {
        x: position.x,
        y: position.y,
        z: position.z,
        duration: 1,
        ease: 'power2.inOut',
      })
      gsap.to(controls.target, {
        x: target.x,
        y: target.y,
        z: target.z,
        duration: 1,
        ease: 'power2.inOut',
        onComplete: () => {
          controls.enabled = true
        },
      })
    }
  }

  // 绑定 RobotArm
  public bindRobotArm(robotArm: RobotArm): void {
    this.robotArm = robotArm
    // 添加关节控制
    const jointFolder = this.pane.addFolder({
      title: '关节控制',
      expanded: true,
    })

    this.robotArm!.toggleAxisHelper(false)
    jointFolder.addBinding({ axisHelper: false }, 'axisHelper').on('change', ev => {
      this.robotArm!.toggleAxisHelper(ev.value)
    })

    const jointConfigs = this.robotArm.getJointConfigs()
    const gripperConfigs = this.robotArm.getGripperConfigs()

    jointConfigs.forEach(config => {
      const jointControl = jointFolder.addBinding(config, 'currentAngle', {
        min: config.minAngle,
        max: config.maxAngle,
        step: 1,
        label: config.name,
      })

      jointControl.on('change', ev => {
        if (this.animationControls.isPlaying || this.animationControls.isDragActionProgress) {
          return
        }
        console.log('jointControl.on change', config.name, ev.value)
        this.robotArm!.setJointAngle(config.name, ev.value)
      })

      this.jointControls.set(config.name, jointControl)
    })

    jointFolder.addBlade({ view: 'separator' })

    gripperConfigs.forEach(config => {
      const gripperControl = jointFolder.addBinding(config, 'currentAngle', {
        min: config.minAngle,
        max: config.maxAngle,
        step: 1,
        label: config.name,
      })
      gripperControl.on('change', ev => {
        if (this.animationControls.isPlaying || this.animationControls.isDragActionProgress) {
          return
        }
        console.log('gripperControl.on change', config.name, ev.value)
        this.robotArm!.setGripperAngle(config.name, ev.value)
      })

      this.jointControls.set(config.name, gripperControl)
    })
    jointFolder
      .addBinding({ openness: 0 }, 'openness', {
        min: 0,
        max: 1,
        step: 0.01,
      })
      .on('change', ev => {
        if (this.animationControls.isPlaying) {
          return
        }
        this.animationControls.isDragActionProgress = true
        console.log('opennessControl.on change', ev.value)
        this.robotArm!.setGripperOpenness(ev.value)
        this.updateJointControls()
        this.animationControls.isDragActionProgress = false
      })

    // reset
    this.resetButton = jointFolder
      .addButton({
        title: 'idle pose',
      })
      .on('click', () => {
        this.resetToDefault()
      })

    // 预设动作
    const presetFolder = this.pane.addFolder({
      title: '预设动作',
      expanded: true,
    })

    // 动作选择
    presetFolder
      .addBinding(this.animationControls, 'selectedAction', {
        view: 'list',
        label: '预设',
        options: [
          { text: '抓取&放置', value: 'pick_and_place.json' },
          { text: '示例', value: 'demo_action.json' },
        ],
      })
      .on('change', () => {
        // 当选择新的动作序列时，加载该序列
        this.loadSelectedAction()
      })

    // 执行控制按钮
    const controlsFolder = presetFolder.addFolder({ title: '执行控制', expanded: true })

    // 执行按钮
    this.playButton = controlsFolder
      .addButton({
        title: '执行',
      })
      .on('click', () => {
        this.playJSONAction()
      })

    this.pauseButton = controlsFolder
      .addButton({
        title: '暂停/恢复',
      })
      .on('click', () => {
        this.togglePause()
      })

    this.stopButton = controlsFolder
      .addButton({
        title: '停止',
      })
      .on('click', () => {
        this.stopAnimationAndReset()
      })

    // 初始化按钮显示状态
    this.updateButtonStates()

    // 进度控制
    this.progressBinding = controlsFolder.addBinding(this.animationControls, 'actionProgress', {
      min: 0,
      max: 1,
      step: 0.01,
      label: '动作进度',
    })

    this.progressBinding.on('change', ev => {
      if (this.animationControls.isPlaying) {
        return
      }
      if (this.robotArm) {
        this.animationControls.isDragActionProgress = true
        this.robotArm.setAnimationProgress(ev.value as number)
        this.animationControls.currentFrameId =
          this.robotArm.getAnimationState().currentKeyFrameIndex
        this.updateJointControls()
        this.animationControls.isDragActionProgress = false
      }
    })

    // 状态显示
    const statusFolder = presetFolder.addFolder({ title: '状态信息', expanded: true })

    this.stateBinding = statusFolder.addBinding(this.animationControls, 'currentFrameId', {
      label: '当前帧ID',
      readonly: true,
      format: v => v.toFixed(0),
    })

    statusFolder.addBinding(this.animationControls, 'gripperState', {
      label: '机械爪状态',
      readonly: true,
    })

    // 初始化时加载默认的动作序列
    this.loadSelectedAction()
  }

  private resetToDefault(): void {
    this.robotArm!.resetToDefault({
      onUpdate: config => {
        this.animationControls.isPlaying = true
        const control = this.jointControls.get(config.name)
        control && control.refresh()
      },
      onComplete: () => {
        this.animationControls.isPlaying = false
      },
    })
  }

  private updateJointControls(): void {
    this.jointControls.forEach(control => {
      control.refresh()
    })
  }

  // 更新按钮显示状态
  private updateButtonStates(): void {
    if (this.playButton && this.pauseButton && this.stopButton && this.resetButton) {
      if (this.animationControls.isPlaying) {
        // 播放中：隐藏执行按钮，显示暂停和停止按钮
        this.playButton.hidden = true
        this.pauseButton.hidden = false
        this.stopButton.hidden = false
        this.resetButton.disabled = true
      } else {
        // 非播放状态：显示执行按钮，隐藏暂停和停止按钮
        this.playButton.hidden = false
        this.pauseButton.hidden = true
        this.stopButton.hidden = true
        this.resetButton.disabled = false
      }
    }
  }

  // 加载选中的动作序列
  private async loadSelectedAction(): Promise<void> {
    if (!this.robotArm) return

    try {
      // 停止当前动画
      this.stopAnimationAndReset()

      // 加载动作序列
      await this.robotArm.loadActionSequence(this.animationControls.selectedAction)

      console.log(`已加载动作序列: ${this.animationControls.selectedAction}`)
    } catch (error) {
      console.error('加载动作序列失败:', error)
    }
  }

  private async playJSONAction(): Promise<void> {
    if (!this.robotArm) return

    try {
      this.animationControls.isPlaying = true
      this.animationControls.isPaused = false
      this.updateButtonStates()

      await this.robotArm.playActionSequence(this.animationControls.selectedAction, {
        onUpdate: config => {
          const control = this.jointControls.get(config.name)
          control && control.refresh()
        },
        onProgressUpdate: progress => {
          this.animationControls.actionProgress = progress
          this.progressBinding && this.progressBinding.refresh()
        },
        onStateChange: (frameId, frame) => {
          this.animationControls.currentFrameId = frameId
          this.stateBinding && this.stateBinding.refresh()
          console.log(`切换到关键帧 ${frameId}`, frame)
        },
        onGripperChange: isGripping => {
          this.animationControls.gripperState = isGripping
          // TODO: 添加机械爪视觉反馈
          console.log(`机械爪状态: ${isGripping ? '闭合' : '张开'}`)
        },
        onComplete: () => {
          this.animationControls.isPlaying = false
          this.animationControls.isPaused = false
          this.updateButtonStates()
        },
      })
    } catch (error) {
      console.error('播放动作失败:', error)
      this.animationControls.isPlaying = false
      this.animationControls.isPaused = false
      this.updateButtonStates()
    }
  }

  private togglePause(): void {
    if (!this.robotArm) return

    const animState = this.robotArm.getAnimationState()

    if (animState.isPlaying && !animState.isPaused) {
      this.robotArm.pauseAnimation()
      this.animationControls.isPaused = true
      this.animationControls.isPlaying = false
    } else if (animState.isPaused) {
      this.robotArm.resumeAnimation()
      this.animationControls.isPaused = false
      this.animationControls.isPlaying = true
    }
  }

  private stopAnimation(): void {
    if (!this.robotArm) return

    this.robotArm.stopAnimation()
  }

  // 停止动画并将所有关节复位到0度
  private stopAnimationAndReset(): void {
    if (!this.robotArm) return

    // 先停止动画
    this.stopAnimation()

    // 将所有关节平滑复位到0度
    this.robotArm.reset0({
      onUpdate: config => {
        this.animationControls.isPlaying = true
        this.animationControls.isPaused = false
        const control = this.jointControls.get(config.name)
        control && control.refresh()
      },
      onComplete: () => {
        // 刷新动作进度
        this.animationControls.actionProgress = 0
        this.progressBinding && this.progressBinding.refresh()
        // 刷新动作状态
        this.animationControls.currentFrameId = 0
        this.animationControls.gripperState = false
        this.stateBinding && this.stateBinding.refresh()
        // 重置控制按钮状态
        this.animationControls.isPlaying = false
        this.animationControls.isPaused = false
        this.updateButtonStates()
      },
    })
  }
}
