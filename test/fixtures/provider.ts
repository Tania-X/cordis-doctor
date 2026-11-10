export const name = 'demo-provider'

export function apply(ctx: any) {
  ctx.provide('demo-db', { ok: true })
}
