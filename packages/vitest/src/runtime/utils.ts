import type { ModuleCacheMap } from 'vite-node/client'

import type { WorkerGlobalState } from '../types/worker'
import { getSafeTimers } from '@vitest/utils'

const NAME_WORKER_STATE = '__vitest_worker__'

export function getWorkerState(): WorkerGlobalState {
  // @ts-expect-error untyped global
  const workerState = globalThis[NAME_WORKER_STATE]
  if (!workerState) {
    const errorMsg
      = 'Vitest failed to access its internal state.'
        + '\n\nOne of the following is possible:'
        + '\n- "vitest" is imported directly without running "vitest" command'
        + '\n- "vitest" is imported inside "globalSetup" (to fix this, use "setupFiles" instead, because "globalSetup" runs in a different context)'
        + '\n- "vitest" is imported inside Vite / Vitest config file'
        + '\n- Otherwise, it might be a Vitest bug. Please report it to https://github.com/vitest-dev/vitest/issues\n'
    throw new Error(errorMsg)
  }
  return workerState
}

export function provideWorkerState(context: any, state: WorkerGlobalState): WorkerGlobalState {
  Object.defineProperty(context, NAME_WORKER_STATE, {
    value: state,
    configurable: true,
    writable: true,
    enumerable: false,
  })

  return state
}

export function getCurrentEnvironment(): string {
  const state = getWorkerState()
  return state?.environment.name
}

export function isChildProcess(): boolean {
  return typeof process !== 'undefined' && !!process.send
}

export function setProcessTitle(title: string): void {
  try {
    process.title = `node (${title})`
  }
  catch {}
}

export function resetModules(modules: ModuleCacheMap, resetMocks = false): void {
  const skipPaths = [
    // Vitest
    /\/vitest\/dist\//,
    /\/vite-node\/dist\//,
    // yarn's .store folder
    /vitest-virtual-\w+\/dist/,
    // cnpm
    /@vitest\/dist/,
    // don't clear mocks
    ...(!resetMocks ? [/^mock:/] : []),
  ]
  modules.forEach((mod, path) => {
    if (skipPaths.some(re => re.test(path))) {
      return
    }
    modules.invalidateModule(mod)
  })
}

function waitNextTick() {
  const { setTimeout } = getSafeTimers()
  return new Promise(resolve => setTimeout(resolve, 0))
}

export async function waitForImportsToResolve(): Promise<void> {
  await waitNextTick()
  const state = getWorkerState()
  const promises: Promise<unknown>[] = []
  let resolvingCount = 0
  for (const mod of state.moduleCache.values()) {
    if (mod.promise && !mod.evaluated) {
      promises.push(mod.promise)
    }
    if (mod.resolving) {
      resolvingCount++
    }
  }
  if (!promises.length && !resolvingCount) {
    return
  }
  await Promise.allSettled(promises)
  await waitForImportsToResolve()
}
