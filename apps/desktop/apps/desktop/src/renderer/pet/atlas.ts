/**
 * The shared Codex pet atlas contract. Every codex-pet spritesheet is an 8×9 grid of 192×208
 * cells, and a row means the same thing in every pack — which is why swapping one codex pet for
 * another is an edit to a character's `expressions` map and nothing else.
 *
 * Transcribed from `codex-pets-react@0.2.0`, `dist/types/atlas.d.ts` (MIT, backnotprop,
 * https://github.com/backnotprop/codex-pets-react). It is the format's contract, not our design,
 * so it is reproduced rather than invented; per-frame durations are the contract's, not guesses.
 *
 * Verified against the vendored `monthly-salary-cat` sheet on 2026-09-12: it is exactly
 * 1536×1872, and every row holds exactly as many populated cells as its frame count declares.
 */

export interface CodexAnimation {
  readonly row: number
  readonly frames: number
  readonly frameDurations: readonly number[]
}

export const codexAtlas = {
  columns: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208,
  animations: {
    idle: { row: 0, frames: 6, frameDurations: [280, 110, 110, 140, 140, 320] },
    'running-right': { row: 1, frames: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
    'running-left': { row: 2, frames: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
    waving: { row: 3, frames: 4, frameDurations: [140, 140, 140, 280] },
    jumping: { row: 4, frames: 5, frameDurations: [140, 140, 140, 140, 280] },
    failed: { row: 5, frames: 8, frameDurations: [140, 140, 140, 140, 140, 140, 140, 240] },
    waiting: { row: 6, frames: 6, frameDurations: [150, 150, 150, 150, 150, 260] },
    running: { row: 7, frames: 6, frameDurations: [120, 120, 120, 120, 120, 220] },
    review: { row: 8, frames: 6, frameDurations: [150, 150, 150, 150, 150, 280] }
  }
} as const

/** The nine rows a codex pet may declare. A character maps our expressions onto these. */
export type CodexRow = keyof typeof codexAtlas.animations

export function isCodexRow(value: string): value is CodexRow {
  return Object.prototype.hasOwnProperty.call(codexAtlas.animations, value)
}
