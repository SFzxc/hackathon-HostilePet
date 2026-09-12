export interface Bounds { x: number; y: number; width: number; height: number }
export function fitInWorkArea(bounds: Bounds, area: Bounds): Bounds {
  return { ...bounds,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)) }
}
