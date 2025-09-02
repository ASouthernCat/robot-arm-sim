import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Stats from 'stats.js'
import { ControlPanel } from '@/ui/ControlPanel'
import { SceneConfig } from '@/config/Scene'
import type { FolderApi } from '@tweakpane/core'

export class Scene {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private stats: Stats
  private container: HTMLElement
  private textureLoader: THREE.TextureLoader
  private panel: FolderApi

  constructor(container: HTMLElement) {
    this.container = container
    this.panel = ControlPanel.getInstance().getPane().addFolder({
      title: 'Scene',
      expanded: true,
    })

    // 创建纹理加载器
    this.textureLoader = new THREE.TextureLoader()

    // 创建场景
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(SceneConfig.background.color)
    this.panel
      .addBinding(SceneConfig.background, 'color', { label: 'bgColor', view: 'color' })
      .on('change', ev => {
        this.scene.background = new THREE.Color(ev.value)
      })

    // 创建相机
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 500)
    this.camera.position.copy(SceneConfig.camera.defaultPos)

    // 创建渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    // 添加到容器
    this.container.appendChild(this.renderer.domElement)

    // 创建控制器
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.copy(SceneConfig.controls.defaultTarget)
    this.controls.enablePan = false
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.maxPolarAngle = Math.PI / 2

    // 创建性能监控
    this.stats = new Stats()
    this.stats.dom.style.position = 'absolute'
    this.stats.dom.style.top = '0px'
    this.stats.dom.style.left = '0px'
    this.container.appendChild(this.stats.dom)

    // 设置光照
    this.setupLighting()

    // 设置网格
    this.setupGrid()

    // 绑定事件
    this.bindEvents()
  }

  private setupLighting(): void {
    // 环境光
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6)
    this.scene.add(ambientLight)

    // 环境纹理
    let envTextureEquirec = this.textureLoader.load(
      import.meta.env.BASE_URL + 'texture/envmap/room.png'
    )
    envTextureEquirec.mapping = THREE.EquirectangularReflectionMapping
    envTextureEquirec.colorSpace = THREE.SRGBColorSpace
    this.scene.environment = envTextureEquirec

    // 方向光
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 10, 5)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 1024
    directionalLight.shadow.mapSize.height = 1024
    this.scene.add(directionalLight)

    // 点光源
    const pointLight = new THREE.PointLight(0xffffff, 0.5)
    pointLight.position.set(-10, 10, -10)
    this.scene.add(pointLight)
  }

  private setupGrid(): void {
    const grid = new THREE.Group()
    this.scene.add(grid)
    const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0x888888)
    grid.add(gridHelper)

    // 添加坐标轴
    const axesHelper = new THREE.AxesHelper(5)
    axesHelper.position.set(0, 0.001, 0)
    grid.add(axesHelper)
    this.panel.addBinding(grid, 'visible', { label: 'axesHelper' })
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onWindowResize.bind(this))
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  update(_deltaTime?: number): void {
    this.stats.begin()

    this.controls.update()
    this.renderer.render(this.scene, this.camera)

    this.stats.end()
  }

  getScene(): THREE.Scene {
    return this.scene
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

  getControls(): OrbitControls {
    return this.controls
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer
  }

  getStats(): Stats {
    return this.stats
  }
}
