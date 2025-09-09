/**
 * 节流函数配置选项
 */
interface ThrottleOptions {
  /** 执行间隔时间（毫秒） */
  interval?: number
  /** 是否在开始时立即执行 */
  leading?: boolean
  /** 是否在结束时执行 */
  trailing?: boolean
}

/**
 * 节流函数返回值
 */
interface ThrottledFunction<T extends (...args: any[]) => any> {
  /** 节流后的函数 */
  (...args: Parameters<T>): void
  /** 取消节流 */
  cancel: () => void
  /** 立即执行一次 */
  flush: () => void
}

/**
 * 创建节流函数
 * @param func 要节流的函数
 * @param options 节流配置选项
 * @returns 节流后的函数
 *
 * @example
 * ```typescript
 * // 基础用法：一秒内最多执行一次
 * const throttledFn = throttle(myFunction, { interval: 1000 });
 *
 * // 高级用法：配置更多选项
 * const throttledFn = throttle(myFunction, {
 *   interval: 500,     // 500ms 内最多执行一次
 *   leading: true,     // 开始时立即执行
 *   trailing: true     // 结束时执行
 * });
 * ```
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  options: ThrottleOptions = {}
): ThrottledFunction<T> {
  const {
    interval = 1000, // 默认1秒
    leading = true, // 默认开始时立即执行
    trailing = true, // 默认结束时执行
  } = options

  let lastExecTime = 0 // 上次执行时间
  let timeoutId: NodeJS.Timeout | null = null
  let lastArgs: Parameters<T> | null = null // 最后一次调用时的参数
  let lastThis: any = null // 最后一次调用时的this上下文

  // 执行函数
  const execute = () => {
    lastExecTime = Date.now()
    timeoutId = null

    if (lastArgs) {
      func.apply(lastThis, lastArgs)
      lastArgs = null
      lastThis = null
    }
  }

  // 节流函数
  const throttledFunction = function (this: any, ...args: Parameters<T>) {
    const now = Date.now()
    const remaining = interval - (now - lastExecTime)

    // 保存最后一次调用的上下文和参数
    lastThis = this
    lastArgs = args

    // 如果是第一次调用且允许leading执行
    if (lastExecTime === 0 && leading) {
      execute()
      return
    }

    // 如果距离上次执行时间已经超过interval
    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      execute()
      return
    }

    // 如果允许trailing执行，设置定时器
    if (trailing && !timeoutId) {
      timeoutId = setTimeout(execute, remaining)
    }
  } as ThrottledFunction<T>

  // 取消节流
  throttledFunction.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    lastExecTime = 0
    lastArgs = null
    lastThis = null
  }

  // 立即执行一次
  throttledFunction.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (lastArgs) {
      func.apply(lastThis, lastArgs)
      lastArgs = null
      lastThis = null
    }
    lastExecTime = Date.now()
  }

  return throttledFunction
}
