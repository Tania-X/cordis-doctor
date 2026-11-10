import { ACTIVE, stateName, type DoctorContext, type DoctorOptions, type Issue, type Node, type Report } from './types.ts'

/**
 * 采集插件树快照。
 *
 * 服务提供者只能从 `ctx.root.reflect.store` 反查：
 *   - `fiber.provisions` / `fiber.committed` 在 cordis 4.0.0-rc.6 里恒为空，
 *     不能用（踩过）
 *   - `impl.fiber` 与 `entry.fiber` 不是同一引用，比较要用 `fiber.uid`
 */
export function collect(ctx: DoctorContext, options: { includeEffects?: boolean } = {}): { nodes: Node[]; resolved: Set<string>; effects: number } {
  const root: any = (ctx as any).root ?? ctx
  const reflect: any = root.reflect ?? (ctx as any).reflect
  const store = reflect?.store ?? {}

  const owners = new Map<string, number>()
  for (const key of Reflect.ownKeys(store)) {
    const impl: any = store[key]
    const uid = impl?.fiber?.uid
    if (impl?.name && typeof uid === 'number') owners.set(impl.name, uid)
  }

  let effects = 0
  const nodes: Node[] = [...(ctx as any).loader.entries()].map((entry: any) => {
    const fiber = entry.fiber
    const uid = fiber?.uid
    const runtimeProvides: string[] = []
    if (typeof uid === 'number') {
      for (const [service, ownerUid] of owners) {
        if (ownerUid === uid) runtimeProvides.push(service)
      }
    }

    const declared: string[] = Array.isArray(entry.options?.provides) ? entry.options.provides : []
    if (options.includeEffects !== false) effects += fiber?.getEffects?.()?.length ?? 0

    return {
      id: entry.id,
      label: fiber?.runtime?.name ?? entry.id,
      inject: fiber ? Object.keys(fiber.inject ?? {}) : Object.keys(entry.options?.inject ?? {}),
      provides: [...new Set([...declared, ...runtimeProvides])],
      state: fiber?.state ?? 0,
      disabled: !!entry.disabled,
    }
  })

  // 「有没有实现」以服务表为准 —— 由代码直接挂载的服务（如 loader）不属于
  // 任何 entry，按 entry 判断会误报成缺失
  return { nodes, resolved: new Set(owners.keys()), effects }
}

/** 服务名 → 提供它的 entry id 列表 */
export function indexProviders(nodes: Node[]) {
  const map = new Map<string, string[]>()
  for (const node of nodes) {
    for (const service of node.provides) {
      const list = map.get(service)
      if (list) list.push(node.id)
      else map.set(service, [node.id])
    }
  }
  return map
}

/**
 * 三色标记找环。边由「插件依赖的服务 → 提供该服务的插件」构成。
 *
 * 已知局限：provides 若来自运行时反查，未激活的插件没有 provides，
 * 环就查不出来。只有当插件在配置里显式声明 provides 时才可靠。
 */
export function detectCycles(nodes: Node[], providers: Map<string, string[]>) {
  const edges = new Map<string, string[]>()
  for (const node of nodes) {
    const deps = new Set<string>()
    for (const service of node.inject) {
      for (const providerId of providers.get(service) ?? []) deps.add(providerId)
    }
    edges.set(node.id, [...deps])
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  const cycles: string[][] = []
  const seen = new Set<string>()
  const stack: string[] = []

  const dfs = (id: string) => {
    color.set(id, GRAY)
    stack.push(id)
    for (const next of edges.get(id) ?? []) {
      const c = color.get(next) ?? WHITE
      if (c === GRAY) {
        const start = stack.indexOf(next)
        const path = [...stack.slice(start), next]
        const key = [...new Set(path)].sort().join('|')
        if (!seen.has(key)) {
          seen.add(key)
          cycles.push(path)
        }
      } else if (c === WHITE) {
        dfs(next)
      }
    }
    stack.pop()
    color.set(id, BLACK)
  }

  for (const node of nodes) {
    if ((color.get(node.id) ?? WHITE) === WHITE) dfs(node.id)
  }
  return cycles
}

/**
 * 纯函数版本，不碰 Context，方便单测。
 * @param resolved 当前已有实现的服务名集合
 * @param getService 判断某个服务此刻是否真的可用
 */
export function analyze(
  nodes: Node[],
  resolved: Set<string>,
  getService: (name: string) => unknown,
  options: DoctorOptions = {},
): Issue[] {
  const providers = indexProviders(nodes)
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id
  const issues: Issue[] = []

  for (const cycle of detectCycles(nodes, providers)) {
    issues.push({
      kind: 'cycle',
      entries: [...new Set(cycle)],
      services: [],
      message: `循环依赖：${cycle.map(label).join(' → ')}（互相等待，将永久停在 PENDING）`,
    })
  }

  const inCycle = new Set(issues.flatMap((i) => i.entries))

  for (const node of nodes) {
    if (node.disabled && !options.includeDisabled) continue
    // 环里的节点已经单独报过，再报"服务未就绪"只是噪音
    if (inCycle.has(node.id)) continue

    const missing = node.inject.filter((service) => !resolved.has(service))
    if (missing.length) {
      issues.push({
        kind: 'missing',
        entries: [node.id],
        services: missing,
        message: `服务未就绪：${node.label} 依赖 ${missing.join(', ')}，当前没有可用实现（插件缺失，或依赖链上存在循环）`,
      })
      continue
    }

    if (node.state !== ACTIVE) {
      const waiting = node.inject.filter((service) => getService(service) === undefined)
      issues.push({
        kind: 'inactive',
        entries: [node.id],
        services: waiting,
        message: `未激活：${node.label} 处于 ${stateName(node.state)}${waiting.length ? `，等待 ${waiting.join(', ')}` : ''}`,
      })
    }
  }

  return issues
}

/** 对一棵已加载的插件树做一次完整体检 */
export function diagnose(ctx: DoctorContext, options: DoctorOptions = {}): Report {
  const { nodes, resolved, effects } = collect(ctx, options)
  const issues = analyze(nodes, resolved, (name) => ctx.get(name), options)

  const count = (state: number) => nodes.filter((n) => !n.disabled && n.state === state).length

  return {
    healthy: issues.length === 0,
    issues,
    stats: {
      total: nodes.length,
      active: count(ACTIVE),
      pending: count(0),
      failed: count(3),
      disabled: nodes.filter((n) => n.disabled).length,
      services: resolved.size,
      effects: options.includeEffects === false ? 0 : effects,
    },
    at: Date.now(),
  }
}
