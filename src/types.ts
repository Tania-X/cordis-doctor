export type IssueKind = 'cycle' | 'missing' | 'inactive'

/**
 * 本包只依赖 Context 的这几个成员，刻意不 import cordis 的 `Context` 类型。
 *
 * 原因：cordis 生态里同时存在多份 Context（宿主一份、vendor 一份、peer 解析
 * 到另一份），而这些 `Context` 类内部带 unique symbol 成员，structural typing
 * 会判定它们互不兼容 —— 用具体类型会导致 "两个 Context 不是同一型" 的报错。
 * 用最小结构接口，任何版本的 Context 都能直接传进来。
 */
export interface DoctorContext {
  readonly root?: any
  readonly reflect?: any
  readonly loader?: any
  get(name: string): any
  on(name: string, listener: (...args: any[]) => void): any
}

/** Cordis 的 FiberState，两边都是 const enum，这里做运行时镜像 */
export const FIBER_STATE = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
export type FiberStateName = (typeof FIBER_STATE)[number]

const ACTIVE = 2

/**
 * 插件树里一个节点的快照。
 *
 * `provides` 有两个来源：YAML 里显式声明的（可信，但需要作者配合），以及
 * 运行时从服务表反查到的（只对已激活的插件有效）。这也是本工具能力边界的
 * 根源 —— 见 README「为什么环检测有天花板」。
 */
export interface Node {
  id: string
  label: string
  inject: string[]
  provides: string[]
  state: number
  disabled: boolean
}

export interface Issue {
  kind: IssueKind
  /** 涉及的 entry id */
  entries: string[]
  /** 相关的服务名（环可能为空） */
  services: string[]
  /** 给人看的一句话 */
  message: string
}

export interface Stats {
  total: number
  active: number
  pending: number
  failed: number
  disabled: number
  /** 服务表里的服务数量 */
  services: number
  /** 所有插件注册的 effect 总数（受 includeEffects 影响） */
  effects: number
}

export interface Report {
  healthy: boolean
  issues: Issue[]
  stats: Stats
  /** 生成时间戳 */
  at: number
}

export interface DoctorOptions {
  /** 是否统计 effect 数量，默认 true（要遍历每个 fiber 的 disposables，插件很多时可关） */
  includeEffects?: boolean
  /** 是否把 disabled 的插件计入 issues，默认 false */
  includeDisabled?: boolean
}

export function stateName(state: number): string {
  return FIBER_STATE[state] ?? String(state)
}

export { ACTIVE }
