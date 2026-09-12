import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'

/**
 * The watchlist: which domains the desktop recognises, and what each kind of site means.
 *
 * It is **data**, loaded from `packs/site-catalog.json` at runtime, and deliberately not
 * TypeScript: non-negotiable 1 keeps site names out of kernel code, and the same rule is why
 * this file is the only place a domain appears.
 *
 * **This list is the whole of what the build watches.** An unlisted host is ignored outright:
 * `watched` comes back false and `site-tracker` drops the tick before it earns a page, a record
 * or a place in the agent's context. An unrecognised site is not a guess to classify, it is an
 * absence — and policing a site nobody opted into would be enforcement without a commitment
 * (non-negotiable 5). All `default` decides is what an unlisted host is *called* on its way
 * past; no intensity read from it can reach a rule.
 */
export const siteIntensitySchema = z.enum(['low', 'normal', 'high'])
export type SiteIntensity = z.infer<typeof siteIntensitySchema>

const categorySchema = z
  .object({
    label: z.string().min(1),
    intensity: siteIntensitySchema,
    /** Qualifying seconds before the site counts as a distraction worth mentioning. */
    thresholdSeconds: z.number().nonnegative()
  })
  .strict()

export const siteCatalogSchema = z
  .object({
    version: z.literal(1),
    categories: z.record(z.string(), categorySchema),
    sites: z.record(z.string(), z.string()),
    default: z.string().min(1),
    /** Deterministic escalation ladder, in seconds of qualifying time on one page. */
    escalation: z
      .object({
        watchSeconds: z.number().positive(),
        concernedSeconds: z.number().positive(),
        hostileSeconds: z.number().positive(),
        /** No qualifying activity for this long and the level drops back one step. */
        decayAfterSeconds: z.number().positive()
      })
      .strict()
  })
  .strict()

export type SiteCatalog = z.infer<typeof siteCatalogSchema>

export type SiteClassification = {
  site: string
  category: string
  label: string
  intensity: SiteIntensity
  /** True when the site is explicitly listed. Anything else is `other` and inert. */
  watched: boolean
  thresholdMs: number
}

/**
 * Candidate locations, most explicit first. `HOSTILEPET_SITE_CATALOG` exists so a demo can
 * point at an edited watchlist without rebuilding; the packaged path is what ships.
 */
export function catalogPaths(appPath: string, resourcesPath: string, env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    env.HOSTILEPET_SITE_CATALOG,
    `${resourcesPath}/packs/site-catalog.json`,
    `${appPath}/../../packs/site-catalog.json`
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
}

export function loadSiteCatalog(paths: readonly string[]): { catalog: SiteCatalog | null; path: string | null; detail: string | null } {
  for (const path of paths) {
    if (!existsSync(path)) continue
    try {
      const parsed = siteCatalogSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
      if (!parsed.success) return { catalog: null, path, detail: `site catalog is not valid: ${parsed.error.issues[0]?.message ?? 'unknown'}` }
      return { catalog: parsed.data, path, detail: null }
    } catch (error) {
      return { catalog: null, path, detail: `site catalog could not be read: ${error instanceof Error ? error.message : 'unknown'}` }
    }
  }
  return { catalog: null, path: null, detail: `no site catalog found (looked in ${paths.length} location(s))` }
}

/**
 * A watch threshold below this many seconds exists to make a demo happen rather than to describe
 * real attention, and `docs/hackathon.md` §4 requires that to be visible wherever it applies. This
 * is a presentation rule about the catalog, not an enforcement threshold: enforcement compares
 * against the catalog's own numbers, which live in the pack.
 */
export const DEMO_THRESHOLD_CEILING_SECONDS = 300

export function isDemoCatalog(catalog: SiteCatalog): boolean {
  return catalog.escalation.watchSeconds < DEMO_THRESHOLD_CEILING_SECONDS
}

/** Lowercase host, no scheme, no path, no leading `www.` — the form a catalog key takes. */
export function normaliseHost(value: string): string {
  const withoutScheme = value.trim().toLowerCase().replace(/^[a-z]+:\/\//, '')
  const host = withoutScheme.split(/[/?#]/, 1)[0] ?? ''
  return host.replace(/^www\./, '').replace(/\.$/, '')
}

/**
 * Exact key first, then longest suffix on a dot boundary, so `m.youtube.com` and
 * `youtube.com` resolve to the same entry and `notyoutube.com` does not.
 */
export function classifySite(catalog: SiteCatalog, host: string): SiteClassification {
  const site = normaliseHost(host)
  const listed = Object.keys(catalog.sites)
    .filter(key => site === key || site.endsWith(`.${key}`))
    .sort((a, b) => b.length - a.length)[0]
  const category = (listed ? catalog.sites[listed] : undefined) ?? catalog.default
  const entry = catalog.categories[category] ?? { label: category, intensity: 'normal' as const, thresholdSeconds: 0 }
  return {
    site,
    category,
    label: entry.label,
    intensity: entry.intensity,
    watched: listed !== undefined,
    thresholdMs: Math.round(entry.thresholdSeconds * 1000)
  }
}
