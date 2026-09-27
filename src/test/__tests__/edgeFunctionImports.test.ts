// The Edge Runtime resolves bare package specifiers only through the
// `imports` map in supabase/functions/deno.json (found by walking up from
// each function — a per-function `import_map` in config.toml is ignored), and
// a gap there only surfaces at deploy time: the in-process test stack
// resolves the same imports through node_modules and never notices. These
// checks close that gap.

/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const functionsDir = join(root, 'supabase/functions')
const denoConfig = JSON.parse(readFileSync(join(functionsDir, 'deno.json'), 'utf8')) as { imports: Record<string, string>; nodeModulesDir?: string }
const importMap = denoConfig

/** Every relative/bare import in a server-reachable file, following relative imports. */
function serverImportGraph(entries: string[]): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>()
  const bare = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'|(?:^|\n)\s*import\s+'([^']+)'/g)) {
      const specifier = match[1] ?? match[2]
      if (specifier.startsWith('.')) {
        queue.push(resolve(dirname(file), specifier))
      } else if (!specifier.startsWith('jsr:') && !specifier.startsWith('npm:') && !specifier.startsWith('https:')) {
        bare.add(specifier)
        const target = importMap.imports[specifier]
        if (target) queue.push(resolve(functionsDir, target))
      }
    }
  }
  return { files, bare }
}

const functionNames = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
  .map((entry) => entry.name)

describe('Edge Function imports', () => {
  it('maps every bare specifier reachable from a function to an existing file', () => {
    const { bare } = serverImportGraph(functionNames.map((name) => join(functionsDir, name, 'index.ts')))
    for (const specifier of bare) {
      expect(importMap.imports[specifier], `${specifier} is missing from supabase/functions/deno.json's imports`).toBeDefined()
      expect(existsSync(resolve(functionsDir, importMap.imports[specifier])), `${specifier} maps to a file that doesn't exist`).toBe(true)
    }
  })

  it('uses an explicit extension on every relative import the functions reach', () => {
    const { files } = serverImportGraph(functionNames.map((name) => join(functionsDir, name, 'index.ts')))
    for (const file of files) {
      expect(existsSync(file), `${file} is imported by an Edge Function but doesn't exist as written — relative imports need their .ts extension`).toBe(true)
    }
  })

  it('keeps one shared Deno config that every function inherits', () => {
    // A deno.json/deno.jsonc/import_map.json closer to a function would win
    // over the shared one and silently drop its imports map.
    for (const name of functionNames) {
      for (const shadow of ['deno.json', 'deno.jsonc', 'import_map.json']) {
        expect(existsSync(join(functionsDir, name, shadow)), `supabase/functions/${name}/${shadow} would shadow supabase/functions/deno.json`).toBe(false)
      }
    }
    // Without this Deno looks for npm:/jsr: dependencies in the repo's
    // node_modules (it sees the root package.json) and fails to resolve them.
    expect(denoConfig.nodeModulesDir).toBe('none')
  })
})
