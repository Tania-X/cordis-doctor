import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import { diagnose, waitForSettle, watch } from '../src/index.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let failed = 0

function assert(name: string, ok: boolean, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

const ctx = new Context()
ctx.baseUrl = new URL('./', import.meta.url).href

await ctx.plugin(Loader)

await ctx.loader.root.update([
  { id: 'provider', name: './fixtures/provider.ts', provides: ['demo-db'] },
  { id: 'consumer', name: './fixtures/consumer.ts' },
] as any)

await waitForSettle(ctx)
await sleep(300)

const healthy = diagnose(ctx)
assert('健康树无 issue', healthy.healthy, `${healthy.issues.length} issue(s)`)
assert('统计到 2 个插件', healthy.stats.total === 2, JSON.stringify(healthy.stats))
assert('统计到服务数', healthy.stats.services > 0, `services=${healthy.stats.services}`)
assert('统计到 effect 数', healthy.stats.effects >= 1, `effects=${healthy.stats.effects}`)

// watch：禁用 provider 后应收到一个"缺服务"的报告
const reports: any[] = []
const stop = watch(ctx, { onChange: (r) => reports.push(r), debounce: 100 })
await sleep(600)

const provider: any = [...ctx.loader.entries()].find((e: any) => e.id === 'provider')
await provider.update({ disabled: true })
await sleep(900)

const degraded = reports[reports.length - 1]
assert('watch 收到多次回调', reports.length >= 2, `got ${reports.length}`)
assert(
  'watch 捕获到降级',
  !!degraded && !degraded.healthy && degraded.issues.some((i: any) => i.kind === 'missing'),
  degraded ? degraded.issues.map((i: any) => i.kind).join(',') : 'no report',
)
const afterDowngrade = diagnose(ctx)
assert(
  '卸载后 effect 数下降',
  afterDowngrade.stats.effects < healthy.stats.effects,
  `${healthy.stats.effects} -> ${afterDowngrade.stats.effects}`,
)

stop()
const before = reports.length
await sleep(500)
assert('stop() 之后不再回调', reports.length === before, `${before} -> ${reports.length}`)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
