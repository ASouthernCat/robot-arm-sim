import * as THREE from 'three'

export interface TrajectoryPoint {
  position: THREE.Vector3
  time: number
  frameId: number
}

export interface TrajectoryConfig {
  visible: boolean
  lineColor: number
  startPointColor: number
  endPointColor: number
  lineWidth: number
  nodeSize: number
}

export class TrajectoryVisualizer {
  private scene: THREE.Scene
  private trajectoryPoints: TrajectoryPoint[] = []
  private currentDrawnPoints: number = 0
  private lineGeometry: THREE.BufferGeometry | null = null
  private lineMaterial: THREE.LineDashedMaterial | null = null
  private line: THREE.Line | null = null
  private startNode: THREE.Mesh | null = null
  private endNode: THREE.Mesh | null = null
  private startNodeMaterial: THREE.MeshBasicMaterial | null = null
  private endNodeMaterial: THREE.MeshBasicMaterial | null = null
  private isFirstPlay: boolean = true
  private currentSequenceId: string | null = null

  private config: TrajectoryConfig = {
    visible: true,
    lineColor: 0x00ff00,
    startPointColor: 0x0000ff,
    endPointColor: 0xff0000,
    lineWidth: 2,
    nodeSize: 0.01,
  }

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  /**
   * 设置配置
   */
  setConfig(config: Partial<TrajectoryConfig>): void {
    // 保存旧配置用于比较
    const oldConfig = { ...this.config }

    // 更新配置
    this.config = { ...this.config, ...config }

    // 如果可见性改变，更新可见性
    if (oldConfig.visible !== this.config.visible) {
      this.updateVisibility()
    }

    // 如果线条颜色改变，实时更新材质
    if (oldConfig.lineColor !== this.config.lineColor && this.lineMaterial) {
      this.lineMaterial.color.setHex(this.config.lineColor)
    }

    // 如果起始点颜色改变，实时更新材质
    if (oldConfig.startPointColor !== this.config.startPointColor && this.startNodeMaterial) {
      this.startNodeMaterial.color.setHex(this.config.startPointColor)
    }

    // 如果结束点颜色改变，实时更新材质
    if (oldConfig.endPointColor !== this.config.endPointColor && this.endNodeMaterial) {
      this.endNodeMaterial.color.setHex(this.config.endPointColor)
    }
  }

  /**
   * 获取配置
   */
  getConfig(): TrajectoryConfig {
    return { ...this.config }
  }

  /**
   * 开始新的轨迹记录
   */
  startNewTrajectory(sequenceId: string): void {
    // 判断是否是新的动作序列或者轨迹已被清除
    const isNewSequence = this.currentSequenceId !== sequenceId
    const trajectoryCleared = this.trajectoryPoints.length === 0

    if (isNewSequence) {
      // 新的动作序列，清除旧的轨迹
      this.clear()
      this.isFirstPlay = true
      this.currentSequenceId = sequenceId
    } else if (trajectoryCleared) {
      // 同一序列但轨迹已被清除，需要重新记录
      this.isFirstPlay = true
    } else {
      // 同一个序列的重复播放
      this.isFirstPlay = false
    }

    // 重置绘制进度
    this.currentDrawnPoints = 0

    // 如果是重复播放且已有完整轨迹，直接显示
    if (!this.isFirstPlay && this.trajectoryPoints.length > 0) {
      this.drawCompleteTrajectory()
    }
  }

  /**
   * 添加轨迹点
   */
  addTrajectoryPoint(point: TrajectoryPoint): void {
    this.trajectoryPoints.push(point)

    // 如果是首次播放，逐步绘制
    if (this.isFirstPlay) {
      this.updateIncrementalTrajectory()
    }
  }

  /**
   * 逐步更新轨迹（首次播放时）
   */
  private updateIncrementalTrajectory(): void {
    if (!this.config.visible) return

    const pointsCount = this.trajectoryPoints.length

    if (pointsCount < 2) return

    // 更新线条
    this.updateLine()

    // 更新节点
    this.updateNodes()

    this.currentDrawnPoints = pointsCount
  }

  /**
   * 绘制完整轨迹（重复播放时）
   */
  private drawCompleteTrajectory(): void {
    if (!this.config.visible || this.trajectoryPoints.length < 2) return

    this.currentDrawnPoints = this.trajectoryPoints.length

    // 绘制完整线条
    this.updateLine()

    // 绘制所有节点
    this.updateNodes()
  }

  /**
   * 更新线条
   */
  private updateLine(): void {
    // 移除旧的线条
    if (this.line) {
      this.scene.remove(this.line)
      this.lineGeometry?.dispose()
      this.lineMaterial?.dispose()
    }

    // 创建线条几何体
    const points = this.trajectoryPoints.slice(0, this.currentDrawnPoints).map(p => p.position)

    if (points.length < 2) return

    this.lineGeometry = new THREE.BufferGeometry().setFromPoints(points)

    // 创建虚线材质
    this.lineMaterial = new THREE.LineDashedMaterial({
      color: this.config.lineColor,
      linewidth: this.config.lineWidth,
      dashSize: 0.03,
      gapSize: 0.02,
    })

    // 创建线条
    this.line = new THREE.Line(this.lineGeometry, this.lineMaterial)
    this.line.computeLineDistances() // 计算线段距离，用于虚线效果
    this.line.visible = this.config.visible

    this.scene.add(this.line)
  }

  /**
   * 更新节点（只包含起始点和结束点）
   */
  private updateNodes(): void {
    const pointsCount = this.currentDrawnPoints

    // 创建或更新起始节点
    if (pointsCount > 0) {
      const startPoint = this.trajectoryPoints[0]

      if (!this.startNode) {
        // 首次创建起始节点
        const { mesh, material } = this.createNodeWithMaterial(
          startPoint.position,
          this.config.startPointColor
        )
        this.startNode = mesh
        this.startNodeMaterial = material
        this.scene.add(this.startNode)
      } else {
        // 更新起始节点位置（通常不需要，但保持一致性）
        this.startNode.position.copy(startPoint.position)
      }
    }

    // 创建或更新结束节点
    if (pointsCount > 1) {
      const endPoint = this.trajectoryPoints[pointsCount - 1]

      if (!this.endNode) {
        // 首次创建结束节点
        const { mesh, material } = this.createNodeWithMaterial(
          endPoint.position,
          this.config.endPointColor
        )
        this.endNode = mesh
        this.endNodeMaterial = material
        this.scene.add(this.endNode)
      } else {
        // 更新结束节点位置
        this.endNode.position.copy(endPoint.position)
      }
    }
  }

  /**
   * 创建节点球体（返回mesh和material）
   */
  private createNodeWithMaterial(
    position: THREE.Vector3,
    color: number
  ): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
    const geometry = new THREE.SphereGeometry(this.config.nodeSize, 16, 16)
    const material = new THREE.MeshBasicMaterial({ color })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    return { mesh, material }
  }

  /**
   * 更新可见性
   */
  private updateVisibility(): void {
    // 更新线条可见性
    if (this.line) {
      this.line.visible = this.config.visible
    }

    // 起始节点和结束节点始终显示（只要轨迹可见）
    if (this.startNode) {
      this.startNode.visible = this.config.visible
    }

    if (this.endNode) {
      this.endNode.visible = this.config.visible
    }
  }

  /**
   * 设置轨迹可见性
   */
  setVisible(visible: boolean): void {
    this.config.visible = visible
    this.updateVisibility()
  }

  /**
   * 完成轨迹绘制
   */
  finishTrajectory(): void {
    // 标记首次播放完成
    if (this.isFirstPlay && this.trajectoryPoints.length > 0) {
      this.isFirstPlay = false
    }
  }

  /**
   * 清除轨迹
   */
  clear(): void {
    // 清除线条
    if (this.line) {
      this.scene.remove(this.line)
      this.lineGeometry?.dispose()
      this.lineMaterial?.dispose()
      this.line = null
      this.lineGeometry = null
      this.lineMaterial = null
    }

    // 清除起始和结束节点
    if (this.startNode) {
      this.scene.remove(this.startNode)
      this.startNode.geometry.dispose()
      this.startNodeMaterial?.dispose()
      this.startNode = null
      this.startNodeMaterial = null
    }

    if (this.endNode) {
      this.scene.remove(this.endNode)
      this.endNode.geometry.dispose()
      this.endNodeMaterial?.dispose()
      this.endNode = null
      this.endNodeMaterial = null
    }

    // 清除轨迹点
    this.trajectoryPoints = []
    this.currentDrawnPoints = 0
    // 注意：不清除 currentSequenceId 和 isFirstPlay，保持序列标识
  }

  /**
   * 销毁可视化器
   */
  dispose(): void {
    this.clear()
    this.currentSequenceId = null
  }

  /**
   * 获取末端执行器位置（用于轨迹记录）
   */
  static getEndEffectorPosition(robotModel: THREE.Group | null): THREE.Vector3 | null {
    if (!robotModel) return null

    // 查找末端执行器
    let endEffector = new THREE.Object3D()
    endEffector.position.setX(0.15) // 偏移量

    robotModel.traverse(child => {
      if (child.name === 'gripper_base') {
        child.add(endEffector)
      }
    })

    if (endEffector) {
      const worldPosition = new THREE.Vector3()
      endEffector.getWorldPosition(worldPosition)
      return worldPosition
    }

    return null
  }
}
