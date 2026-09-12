import { z } from 'zod'
export const commandSchema = z.enum(['show-pet', 'hide-pet', 'open-settings', 'quit', 'preview-thinking', 'preview-speaking', 'preview-idle'])
export type DesktopCommand = z.infer<typeof commandSchema>

/**
 * What the shell may honestly say about the bridge.
 *
 * `peer.sensors` is a count and not the declared sensors themselves: the renderer needs to
 * know whether the extension is connected, and `docs/architecture.md` §4 keeps pack data
 * behind the kernel boundary rather than in a window.
 */
export const bridgeStatusSchema = z.object({
  phase: z.enum(['stopped', 'listening', 'port-in-use', 'failed']),
  host: z.string(),
  port: z.number().int().nonnegative(),
  security: z.enum(['dev-open', 'paired']),
  peer: z.object({
    extensionVersion: z.string(),
    origin: z.string().nullable(),
    sensors: z.number().int().nonnegative()
  }).strict().nullable(),
  activeLeases: z.number().int().nonnegative(),
  /** Plain language, shown to a person, never parsed. */
  detail: z.string().nullable()
}).strict()
export type BridgeSnapshot = z.infer<typeof bridgeStatusSchema>

export const statusSchema = z.object({
  petVisible: z.boolean(),
  preview: z.enum(['idle', 'thinking', 'speaking']),
  bridge: bridgeStatusSchema,
  /**
   * The transport is real; nothing behind it is. Non-negotiable 10 and
   * `docs/hackathon.md` §4 forbid letting a stub read as a working pack, so the shell
   * reports the transport and the missing pack separately instead of collapsing them into
   * one reassuring word.
   */
  browser: z.literal('no-pack-installed'),
  handler: z.literal('mock'),
  agent: z.literal('not-configured'),
  character: z.literal('placeholder')
}).strict()
export type DesktopStatus = z.infer<typeof statusSchema>
export interface DesktopAPI {
  status: () => Promise<DesktopStatus>
  command: (command: DesktopCommand) => Promise<void>
  onStatus: (listener: (status: DesktopStatus) => void) => () => void
}
