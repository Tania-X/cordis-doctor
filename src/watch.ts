import { diagnose } from './diagnose.ts'
import { waitForSettle } from './settle.ts'
import type { DoctorContext, DoctorOptions, Report } from './types.ts'

export interface WatchOptions extends DoctorOptions {
  /** 每次插件树变化后回调（已防抖） */
  onChange: (report: Report) => void
  /** 防抖窗口，默认 300ms */
  debounce?: number
  /** 首次体检是否立即触发，默认 true（会先等插件树结算，避免误报） */
  immediate?: boolean
  /** 等结算的超时，默认 5000ms */
  settleTimeout?: number
}

/**
 * 持续体检。
 *
 * 与「启动时检查一次」的区别：常驻服务的插件树会漂移 —— 依赖被卸载、
 * 配置热更新、某个插件失败重试。这里挂在 `internal/status`（fiber 状态
 * 变化）和 `loader/config-update` 上，把每次变化后的健康状态推出来。
 *
 * 监听器注册在调用方的 fiber 上，插件卸载时自动清理。
 *
 * @returns 手动停止函数
 */
export function watch(ctx: DoctorContext, options: WatchOptions): () => void {
  const debounce = options.debounce ?? 300
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let ready = false

  const run = () => {
    if (disposed) return
    try {
      options.onChange(diagnose(ctx, options))
    } catch {
      // 体检自身不能影响宿主
    }
  }

  const schedule = () => {
    if (disposed || !ready) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      run()
    }, debounce)
  }

  if (options.immediate === false) {
    ready = true
  } else {
    void waitForSettle(ctx, options.settleTimeout ?? 5000).then(() => {
      if (disposed) return
      ready = true
      run()
    })
  }

  const stops = [
    (ctx as any).on('internal/status', schedule),
    (ctx as any).on('loader/config-update', schedule),
  ]

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    for (const stop of stops) {
      try {
        stop?.()
      } catch {
        // ignore
      }
    }
  }
}
