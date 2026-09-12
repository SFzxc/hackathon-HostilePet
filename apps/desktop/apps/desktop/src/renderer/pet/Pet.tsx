import { useEffect, useState } from 'react'
import type { PetExpression } from '../../shared/desktop'
import { codexAtlas, isCodexRow, type CodexAnimation } from './atlas'
import character from '../assets/characters/monthly-salary-cat/character.json'
import sheet from '../assets/characters/monthly-salary-cat/spritesheet.webp'

/**
 * The pet, drawn from a character's spritesheet. This is the one component that knows what a
 * state looks like: everything upstream deals in `PetExpression`, and the character's
 * `expressions` map is what turns one into a row of the atlas. Swapping characters is therefore
 * a change of asset directory, not of code.
 *
 * A character that does not map an expression falls back to `idle` rather than rendering
 * nothing — a pet that vanishes on an unmapped state would read as a crash.
 *
 * The expression is also carried as a class, which is what a stylesheet or a smoke test uses to
 * ask "is the pet currently in this state?" without reading the spritesheet's arithmetic.
 */
function animationFor(expression: PetExpression): CodexAnimation {
  const mapped: string = character.expressions[expression] ?? 'idle'
  const row = isCodexRow(mapped) ? mapped : 'idle'
  return codexAtlas.animations[row]
}

/** True when the person has asked the system to reduce motion; then the sheet holds on frame 0. */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Walks the row's frames on the durations the atlas declares. The timer is rescheduled per frame
 * rather than run on a fixed interval, because the durations are deliberately uneven — the last
 * frame of every row holds longer, which is what stops a loop from looking like a stutter.
 */
function useFrame(animation: CodexAnimation): number {
  const [index, setIndex] = useState(0)
  const key = `${animation.row}`
  useEffect(() => {
    setIndex(0)
    if (prefersReducedMotion()) return
    let timer: ReturnType<typeof setTimeout>
    let frame = 0
    const advance = (): void => {
      timer = setTimeout(() => {
        frame = (frame + 1) % animation.frameDurations.length
        setIndex(frame)
        advance()
      }, animation.frameDurations[frame])
    }
    advance()
    return () => { clearTimeout(timer) }
  }, [key, animation])
  return index
}

export function Pet({ large = false, expression = 'idle' }: { large?: boolean; expression?: PetExpression }) {
  const animation = animationFor(expression)
  const frame = useFrame(animation)
  // A spritesheet is a grid of `columns` × `rows` cells; scaling the sheet to 800%/900% of the
  // element makes each cell exactly one element wide, so a cell is selected by percentage and the
  // element stays free to be any size. The `- 1` is what turns a cell count into the last cell's
  // position.
  const backgroundPosition = `${(frame * 100) / (codexAtlas.columns - 1)}% ${(animation.row * 100) / (codexAtlas.rows - 1)}%`
  return <div
    className={`sprite ${expression} ${large ? 'large' : ''}`}
    role="img"
    aria-label={`${character.displayName}, ${expression}`}
    style={{ backgroundImage: `url(${sheet})`, backgroundPosition }}
  />
}
