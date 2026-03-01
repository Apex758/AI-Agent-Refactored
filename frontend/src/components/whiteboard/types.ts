// ── ScenePlan types for whiteboard_present() ──────────────────────

export interface ScenePlanElement {
  /** Unique id for this element */
  id: string
  /** Element type */
  type: 'text' | 'image' | 'svg'
  /** Normalized x position [0..1] relative to viewport */
  x: number
  /** Normalized y position [0..1] relative to viewport */
  y: number
  /** Normalized width [0..1] relative to viewport */
  w: number
  /** Normalized height [0..1] relative to viewport */
  h: number
  /** Text content (for type 'text') */
  text?: string
  /** Image URL (for type 'image') */
  url?: string
  /** Font size in px (for type 'text', default 24) */
  fontSize?: number
}

export interface ScenePlan {
  /** Elements to place on the canvas */
  elements: ScenePlanElement[]
  /** Snap elements to grid */
  snap?: boolean
  /** Grid size in px (default 50) */
  gridSize?: number
}

export type UIMode = 'chat' | 'whiteboard'