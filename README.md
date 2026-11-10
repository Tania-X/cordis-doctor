# cordis-doctor

Runtime health checks for [Cordis](https://github.com/cordiverse/cordis) plugin trees.

Cordis has no dependency diagnostics by design. This adds them without touching the kernel.

```
循环依赖：cycle-a → cycle-b → cycle-a（互相等待，将永久停在 PENDING）
服务未就绪：ops-panel 依赖 loader，当前没有可用实现
未激活：disk-check 处于 PENDING，等待 timer
```

## The problem

A Cordis plugin that waits for a missing service, and two plugins waiting on each other, both look like a normal startup: `state = PENDING`, no error, no log. The kernel only knows "is every injected service resolvable?" — if not, it does nothing. That is the right trade-off for a framework where plugins come and go at runtime, but it means a misconfigured tree fails silently.

`cordis-doctor` reads the same information the kernel has and turns it into a verdict.

## Install

```bash
npm i cordis-doctor
```

No runtime dependencies. It only reads a `Context` object, so it works with any `cordis` 4.x — including vendored copies whose type identities differ. The package ships TypeScript source; run it with `tsx` or let your bundler handle it.

## Usage

### One-shot check at boot

```ts
import { diagnose, waitForSettle } from 'cordis-doctor'

await ctx.loader.root.update(entries)
await waitForSettle(ctx)          // do NOT rely on loader.await() — see below

const report = diagnose(ctx)
for (const issue of report.issues) ctx.logger.error(issue.message)
if (!report.healthy && process.env.STRICT_BOOT === '1') process.exit(1)
```

### Continuous checks while running

This is the part a boot-time assertion cannot do: a long-running tree drifts. A dependency gets unloaded, a config hot-reloads, a plugin fails and retries.

```ts
import { watch } from 'cordis-doctor'

const stop = watch(ctx, {
  onChange(report) {
    metrics.pluginTreeHealthy.set(report.healthy ? 1 : 0)
    metrics.pendingPlugins.set(report.stats.pending)
  },
  debounce: 300,
})

// later
stop()
```

`watch` listens on `internal/status` (fiber state transitions) and `loader/config-update`. Listeners are registered on the calling fiber, so unloading that plugin stops the watcher automatically.

### Report shape

```ts
interface Report {
  healthy: boolean
  issues: Issue[]            // { kind, entries, services, message }
  stats: {
    total, active, pending, failed, disabled,
    services,                // number of services in the resolve table
    effects,                 // total registered effects across fibers
  }
  at: number
}
```

`issues` is structured on purpose — it is meant to be fed to a dashboard or an agent, not only printed.

## Two things that surprised us

**1. `loader.await()` is not enough.** With a dozen entries in one YAML, it returns before the later entries have a fiber at all (entry initialisation imports modules serially). A check run at that moment reports "not activated" for plugins that are merely still importing. `waitForSettle()` polls until every enabled entry has a fiber.

**2. Service ownership must come from `reflect.store`.** In cordis 4.0.0-rc.6 both `fiber.provisions` and `fiber.committed` are empty, and `impl.fiber` is not the same object reference as `entry.fiber` — compare `fiber.uid` instead. Also, services mounted directly in code (e.g. `loader`) belong to no entry, so deciding "is this service available?" from entries alone produces false positives.

## Declaring `provides`

`provide()` runs inside `apply()`. A plugin that never activated never provided anything, so "what would this plugin provide?" does not exist at runtime. For a cycle, neither side ever runs — the information is simply absent.

To make cycles detectable, declare what a plugin provides in the loader config. Cordis preserves unknown fields:

```yaml
- id: session
  name: ./src/session.ts
  provides: [session]
```

Undeclared plugins still work with the other two checks; they just cannot participate in cycle detection until they are active.

## Comparison

| | Approach | Failure strategy |
|---|---|---|
| **DeepSeek Harness** (`dsh-app-boot`) | Audits entries after settle, reports unresolved services, throws | Process exits |
| **Koishi** | Console shows plugin state | Nothing blocks, nothing warns |
| **cordis-doctor** | Same audit, plus cycle detection and a continuous watcher | Caller decides; nothing is thrown by the library |

The difference is not that the others missed something. It is deployment shape: dsh boots a CLI once and failing fast is the cheapest diagnostic; a long-running service needs to stay up, show why it is degraded, and keep reporting as the tree drifts.

## Limits

- Cycle detection requires `provides` declarations (see above).
- `stats.effects` walks every fiber's disposables. Pass `includeEffects: false` for very large trees.
- Tested against `cordis@4.0.0-rc.6`. The API surface used is `loader.entries()`, `fiber.inject`, `fiber.state`, `fiber.uid`, `fiber.getEffects()`, `ctx.get()`, `ctx.root.reflect.store`.

## License

MIT
