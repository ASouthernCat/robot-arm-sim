import { Pane } from 'tweakpane'
import { RobotArm } from '../core/RobotArm'
import { Scene } from '../core/Scene'
import gsap from 'gsap'
import { SceneConfig } from '@/config/Scene'
import * as THREE from 'three'
import type { BindingApi } from '@tweakpane/core'

export class ControlPanel {
  private pane: Pane
  private robotArm: RobotArm | null = null
  private scene: Scene | null = null
  private jointControls: Map<string, BindingApi> = new Map()
  private static instance: ControlPanel | null = null

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
    this.moveCamera(new THREE.Vector3(0, 1.5, 5), new THREE.Vector3(0, 1.5, 0))
  }

  private setMainView(): void {
    this.moveCamera(SceneConfig.camera.defaultPos, SceneConfig.controls.defaultTarget)
  }

  private setTopView(): void {
    const epsilon = 0.0001 // 极小偏移量，避免 phi=0 奇点
    this.moveCamera(new THREE.Vector3(0, 10, epsilon), new THREE.Vector3(0, 0, 0))
  }

  private setSideView(): void {
    this.moveCamera(new THREE.Vector3(5, 1.5, 0), new THREE.Vector3(0, 1.5, 0))
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

    jointConfigs.forEach(config => {
      const jointControl = jointFolder.addBinding(config, 'currentAngle', {
        min: config.minAngle,
        max: config.maxAngle,
        step: 1,
        label: config.name,
      })

      jointControl.on('change', ev => {
        this.robotArm!.setJointAngle(config.name, ev.value)
      })

      this.jointControls.set(config.name, jointControl)
    })

    //TODO: 添加预设动作
    const presetFolder = this.pane.addFolder({
      title: '预设动作',
      expanded: true,
    })

    presetFolder
      .addButton({
        title: '重置位置',
      })
      .on('click', () => {
        this.resetToDefault()
      })
  }

  private resetToDefault(): void {
    const jointConfigs = this.robotArm!.getJointConfigs()
    jointConfigs.forEach(config => {
      gsap.killTweensOf(config, 'currentAngle')
      const duration = (Math.abs(config.currentAngle - config.defaultAngle) / 360) * 2 // 保持匀速运动
      gsap.to(config, {
        currentAngle: config.defaultAngle,
        duration,
        ease: 'none',
        onUpdate: () => {
          this.robotArm!.setJointAngle(config.name, config.currentAngle)
          const control = this.jointControls.get(config.name)
          control && control.refresh()
        },
      })
    })
  }

  getPane(): Pane {
    return this.pane
  }
}
