import type { TestSpecification } from 'vitest/node'
import { describe, expect, test } from 'vitest'
import { runVitest } from '../../test-utils'

describe('default reporter', async () => {
  test('normal', async () => {
    const { stdout } = await runVitest({
      include: ['b1.test.ts', 'b2.test.ts'],
      root: 'fixtures/default',
      reporters: 'none',
      fileParallelism: false,
      sequence: {
        sequencer: class StableTestFileOrderSorter {
          sort(files: TestSpecification[]) {
            return files.sort((a, b) => a.moduleId.localeCompare(b.moduleId))
          }

          shard(files: TestSpecification[]) {
            return files
          }
        },
      },
    })

    expect(trimReporterOutput(stdout)).toMatchInlineSnapshot(`
      "❯ b1.test.ts (13 tests | 1 failed) [...]ms
         ✓ b1 passed > b1 test [...]ms
         ✓ b1 passed > b2 test [...]ms
         ✓ b1 passed > b3 test [...]ms
         ✓ b1 passed > nested b > nested b1 test [...]ms
         ✓ b1 passed > nested b > nested b2 test [...]ms
         ✓ b1 passed > nested b > nested b3 test [...]ms
         ✓ b1 failed > b1 test [...]ms
         ✓ b1 failed > b2 test [...]ms
         ✓ b1 failed > b3 test [...]ms
         × b1 failed > b failed test [...]ms
           → expected 1 to be 2 // Object.is equality
         ✓ b1 failed > nested b > nested b1 test [...]ms
         ✓ b1 failed > nested b > nested b2 test [...]ms
         ✓ b1 failed > nested b > nested b3 test [...]ms
       ❯ b2.test.ts (13 tests | 1 failed) [...]ms
         ✓ b2 passed > b1 test [...]ms
         ✓ b2 passed > b2 test [...]ms
         ✓ b2 passed > b3 test [...]ms
         ✓ b2 passed > nested b > nested b1 test [...]ms
         ✓ b2 passed > nested b > nested b2 test [...]ms
         ✓ b2 passed > nested b > nested b3 test [...]ms
         ✓ b2 failed > b1 test [...]ms
         ✓ b2 failed > b2 test [...]ms
         ✓ b2 failed > b3 test [...]ms
         × b2 failed > b failed test [...]ms
           → expected 1 to be 2 // Object.is equality
         ✓ b2 failed > nested b > nested b1 test [...]ms
         ✓ b2 failed > nested b > nested b2 test [...]ms
         ✓ b2 failed > nested b > nested b3 test [...]ms"
    `)
  })

  test('show full test suite when only one file', async () => {
    const { stdout } = await runVitest({
      include: ['a.test.ts'],
      root: 'fixtures/default',
      reporters: 'none',
    })

    expect(stdout).contain('✓ a passed > a1 test')
    expect(stdout).contain('✓ a passed > nested a > nested a3 test')
    expect(stdout).contain('× a failed > a failed test')
    expect(stdout).contain('nested a failed 1 test')
  })

  test('rerun should undo', async () => {
    const { vitest } = await runVitest({
      root: 'fixtures/default',
      watch: true,
      testNamePattern: 'passed',
      reporters: 'none',
    })

    // one file
    vitest.write('p')
    await vitest.waitForStdout('Input filename pattern')
    vitest.write('a')
    await vitest.waitForStdout('a.test.ts')
    vitest.write('\n')
    await vitest.waitForStdout('Filename pattern: a')
    await vitest.waitForStdout('Waiting for file changes...')

    expect(vitest.stdout).contain('✓ a passed > a1 test')
    expect(vitest.stdout).contain('✓ a passed > nested a > nested a3 test')

    // rerun and two files
    vitest.write('p')
    await vitest.waitForStdout('Input filename pattern')
    vitest.write('b\n')
    await vitest.waitForStdout('Waiting for file changes...')
    expect(vitest.stdout).toContain('✓ b1.test.ts')
    expect(vitest.stdout).toContain('✓ b2.test.ts')
    expect(vitest.stdout).not.toContain('✓ nested b1 test')
    expect(vitest.stdout).not.toContain('✓ b1 test')
    expect(vitest.stdout).not.toContain('✓ b2 test')
  })

  test('doesn\'t print error properties', async () => {
    const result = await runVitest({
      root: 'fixtures/error-props',
      reporters: 'default',
      env: { CI: '1' },
    })

    expect(result.stderr).not.toContain(`Serialized Error`)
    expect(result.stderr).not.toContain(`status: 'not found'`)
  })

  test('prints queued tests as soon as they are added', async () => {
    const { stdout, vitest } = await runVitest({
      include: ['fixtures/long-loading-task.test.ts'],
      reporters: [['default', { isTTY: true, summary: true }]],
      config: 'fixtures/vitest.config.ts',
      watch: true,
    })

    await vitest.waitForStdout('❯ fixtures/long-loading-task.test.ts [queued]')
    await vitest.waitForStdout('Waiting for file changes...')

    expect(stdout).toContain('✓ fixtures/long-loading-task.test.ts (1 test)')
  })

  test('prints skipped tests by default when a single file is run', async () => {
    const { stdout } = await runVitest({
      include: ['fixtures/all-passing-or-skipped.test.ts'],
      reporters: [['default', { isTTY: true, summary: false }]],
      config: 'fixtures/vitest.config.ts',
    })

    expect(stdout).toContain('✓ fixtures/all-passing-or-skipped.test.ts (2 tests | 1 skipped)')
    expect(stdout).toContain('✓ 2 + 3 = 5')
    expect(stdout).toContain('↓ 3 + 3 = 6')
  })

  test('hides skipped tests when --hideSkippedTests and a single file is run', async () => {
    const { stdout } = await runVitest({
      include: ['fixtures/all-passing-or-skipped.test.ts'],
      reporters: [['default', { isTTY: true, summary: false }]],
      hideSkippedTests: true,
      config: false,
    })

    expect(stdout).toContain('✓ fixtures/all-passing-or-skipped.test.ts (2 tests | 1 skipped)')
    expect(stdout).toContain('✓ 2 + 3 = 5')
    expect(stdout).not.toContain('↓ 3 + 3 = 6')
  })

  test('prints retry count', async () => {
    const { stdout } = await runVitest({
      include: ['fixtures/retry.test.ts'],
      reporters: [['default', { isTTY: true, summary: false }]],
      retry: 3,
      config: false,
    })

    expect(stdout).toContain('1 passed')
    expect(trimReporterOutput(stdout)).toContain('✓ pass after retries [...]ms (retry x3)')
  })

  test('prints repeat count', async () => {
    const { stdout } = await runVitest({
      include: ['fixtures/repeats.test.ts'],
      reporters: [['default', { isTTY: true, summary: false }]],
      config: false,
    })

    expect(stdout).toContain('1 passed')
    expect(trimReporterOutput(stdout)).toContain('✓ repeat couple of times [...]ms (repeat x3)')
  })

  test('prints 0-based index and 1-based index of the test case', async () => {
    const { stdout } = await runVitest({
      include: ['print-index.test.ts'],
      root: 'fixtures/default',
      reporters: 'none',
    })

    expect(stdout).toContain('✓ passed > 0-based index of the test case is 0')
    expect(stdout).toContain('✓ passed > 0-based index of the test case is 1')
    expect(stdout).toContain('✓ passed > 0-based index of the test case is 2')

    expect(stdout).toContain('✓ passed > 1-based index of the test case is 1')
    expect(stdout).toContain('✓ passed > 1-based index of the test case is 2')
    expect(stdout).toContain('✓ passed > 1-based index of the test case is 3')
  })
}, 120000)

function trimReporterOutput(report: string) {
  const rows = report.replace(/\d+ms/g, '[...]ms').split('\n')

  // Trim start and end, capture just rendered tree
  rows.splice(0, 1 + rows.findIndex(row => row.includes('RUN  v')))
  rows.splice(rows.findIndex(row => row.includes('Test Files')))

  return rows.join('\n').trim()
}
