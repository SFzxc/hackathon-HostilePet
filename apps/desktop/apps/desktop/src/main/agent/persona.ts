import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The persona artifact is runtime data, like the site catalog: it ships next to the build and is
 * read at startup, never bundled into a source file. `docs/tone.md` §8 says the prompt lives in
 * `prompts/persona.md`; this is only how the kernel finds it.
 */
export type PersonaLoad = { template: string | null; path: string | null; detail: string | null }

export function personaPaths(appPath: string, resourcesPath: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const paths = [
    // Development: `apps/desktop/apps/desktop` → `apps/desktop/prompts`.
    join(appPath, '..', '..', 'prompts', 'persona.md'),
    // Packaged: `extraResources` copies the same files into the app bundle.
    join(resourcesPath, 'prompts', 'persona.md')
  ]
  if (env.HOSTILEPET_PERSONA) paths.unshift(env.HOSTILEPET_PERSONA)
  return paths
}

export function loadPersona(appPath: string, resourcesPath: string, env: NodeJS.ProcessEnv = process.env): PersonaLoad {
  const paths = personaPaths(appPath, resourcesPath, env)
  const failures: string[] = []
  for (const path of paths) {
    try {
      const template = readFileSync(path, 'utf8')
      if (template.trim().length === 0) {
        failures.push(`${path} is empty`)
        continue
      }
      return { template, path, detail: null }
    } catch (error) {
      failures.push(`${path}: ${error instanceof Error ? error.message : 'unreadable'}`)
    }
  }
  return { template: null, path: null, detail: `the persona artifact could not be read (${failures.join('; ')})` }
}
