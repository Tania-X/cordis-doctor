export const name = 'demo-consumer'
export const inject = ['demo-db']

export function apply(ctx: any) {
  ctx.get('demo-db')
}
