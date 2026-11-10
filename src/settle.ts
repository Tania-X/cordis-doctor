import type { DoctorContext } from './types.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 等插件树真正结算。
 *
 * 不要用 `loader.await()` 代替它：实测在一条 YAML 里塞十几个 entry 时，
 * `loader.await()` 返回的那一刻，后面的 entry 连 fiber 都还没建（entry 初始化
 * 是异步串行 import）。此时体检会把「还在导入」误判成「未激活」。
 *
 * @returns true 表示全部 entry 都拿到了 fiber；false 表示超时
 */
export async function waitForSettle(ctx: DoctorContext, timeout = 5000): Promise<boolean> {
  const loader: any = (ctx as any).loader
  if (!loader?.entries) return true

  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const notStarted = [...loader.entries()].filter((entry: any) => !entry.disabled && entry.fiber?.uid == null)
    if (!notStarted.length) return true
    await sleep(100)
  }
  return false
}
