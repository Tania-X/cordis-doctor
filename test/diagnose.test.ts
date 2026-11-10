import { analyze, type IssueKind, type Node } from '../src/index.ts'

const ACTIVE = 2
const PENDING = 0

const node = (id: string, inject: string[], provides: string[], state = ACTIVE): Node => ({
  id,
  label: id,
  inject,
  provides,
  state,
  disabled: false,
})

let failed = 0

function check(name: string, nodes: Node[], expectIssues: number, expectKinds: IssueKind[]) {
  const resolved = new Set(nodes.filter((n) => n.state === ACTIVE).flatMap((n) => n.provides))
  const issues = analyze(nodes, resolved, (service) => {
    const provider = nodes.find((n) => n.provides.includes(service))
    return provider && provider.state === ACTIVE ? { from: provider.id } : undefined
  })
  const kinds = issues.map((i) => i.kind)
  const ok = issues.length === expectIssues && expectKinds.every((k) => kinds.includes(k))
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} → ${issues.length} issue(s) [${kinds.join(', ')}]`)
  for (const i of issues) console.log(`       ${i.message}`)
}

check('正常链', [node('a', [], ['sa']), node('b', ['sa'], ['sb']), node('c', ['sb'], [])], 0, [])

check('二元环', [node('A', ['sb'], ['sa'], PENDING), node('B', ['sa'], ['sb'], PENDING)], 1, ['cycle'])

check('三元环', [
  node('A', ['sc'], ['sa'], PENDING),
  node('B', ['sa'], ['sb'], PENDING),
  node('C', ['sb'], ['sc'], PENDING),
], 1, ['cycle'])

check('自依赖', [node('S', ['me'], ['me'], PENDING)], 1, ['cycle'])

check('缺服务', [node('reporter', ['db'], [])], 1, ['missing'])

check('环与缺失并存', [
  node('A', ['sb'], ['sa'], PENDING),
  node('B', ['sa'], ['sb'], PENDING),
  node('lonely', ['nobody'], []),
], 2, ['cycle', 'missing'])

check('提供商自身挂起', [node('p', [], ['db'], PENDING), node('c', ['db'], [], PENDING)], 2, [
  'inactive',
  'missing',
])

check('环里的节点不重复报缺失', [
  node('A', ['sb'], ['sa'], PENDING),
  node('B', ['sa'], ['sb'], PENDING),
  node('C', ['sa'], []),
], 2, ['cycle', 'missing'])

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
