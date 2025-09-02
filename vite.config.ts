import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'

const mode = process.env.NODE_ENV
const env = loadEnv(mode || 'development', process.cwd())

// https://vite.dev/config/
export default defineConfig({
  plugins: [],
  server: {
    port: 5500,
    host: '0.0.0.0',
  },
  resolve: {
    // 路径别名
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  base: env.VITE_BASE_URL,
  build: {
    // 启用代码分割
    rollupOptions: {
      output: {
        manualChunks: {
          // Three.js 相关库
          'three-core': ['three'],
          // 常用库单独打包
          libs: [
            'tweakpane',
            'gsap',
            'stats.js',
            'three/examples/jsm/controls/OrbitControls.js',
            'three/examples/jsm/loaders/GLTFLoader.js',
            'three/examples/jsm/loaders/DRACOLoader.js',
          ],
        },
        // chunk命名
        chunkFileNames: chunkInfo => {
          const facadeModuleId = chunkInfo.facadeModuleId
          if (facadeModuleId) {
            const fileName = facadeModuleId.split('/').pop()?.replace('.ts', '')
            return `js/${fileName}-[hash].js`
          }
          return 'js/[name]-[hash].js'
        },
        // 资源命名
        assetFileNames: assetInfo => {
          const info = assetInfo.name?.split('.') || []
          const ext = info[info.length - 1]
          if (/\.(css)$/.test(assetInfo.name || '')) {
            return `css/[name]-[hash].${ext}`
          }
          if (/\.(png|jpe?g|svg|gif|tiff|bmp|ico)$/i.test(assetInfo.name || '')) {
            return `images/[name]-[hash].${ext}`
          }
          return `assets/[name]-[hash].${ext}`
        },
      },
    },
    // 启用压缩
    minify: 'terser',
    terserOptions: {
      compress: {
        // 移除console和debugger
        drop_console: true,
        drop_debugger: true,
        // 移除未使用的变量和函数
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
      },
      mangle: {
        // 混淆变量名
        safari10: true,
      },
    },
    // 启用CSS代码分割
    cssCodeSplit: true,
    // 设置chunk大小警告阈值
    chunkSizeWarningLimit: 1000,
    // 启用源码映射（生产环境可选）
    sourcemap: false,
    // 优化依赖预构建
    commonjsOptions: {
      include: [/node_modules/],
    },
  },
})
