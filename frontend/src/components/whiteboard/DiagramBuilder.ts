/**
 * DiagramBuilder — Converts a VisualPlan into native TLDraw shapes.
 *
 * Instead of rendering SVG templates server-side, this builds diagrams
 * directly on the TLDraw canvas using geo shapes, arrows, and text.
 * Everything is editable, resizable, and wraps naturally.
 *
 * Supported diagram types:
 *   diagram_cycle   — ellipses arranged in a circle with curved arrows
 *   diagram_flow    — rectangles stacked vertically with arrows
 *   diagram_labeled — central shape with radial labeled nodes
 *   chart_bar       — rectangles of varying height for bar chart
 *   comparison      — two-column layout with rectangles
 */

import { Editor, createShapeId, TLShapeId } from 'tldraw'

// ── TLDraw color names ───────────────────────────────────────────
const COLORS = [
  'blue', 'green', 'yellow', 'red', 'violet',
  'orange', 'light-blue', 'light-green', 'light-red', 'light-violet',
] as const

type TLColor = typeof COLORS[number] | 'grey' | 'black'

function pickColor(index: number, overrides: Record<string, string>, label: string): TLColor {
  if (overrides[label] && COLORS.includes(overrides[label] as any)) {
    return overrides[label] as TLColor
  }
  return COLORS[index % COLORS.length]
}

// ── Types matching backend VisualSpec ─────────────────────────────

export interface VisualSpec {
  visual_id: string
  visual_type: string
  title: string
  labels: string[]
  connections: Array<{ from: string; to: string; value?: number }>
  purpose: string
  complexity?: string
  colors?: Record<string, string>
}

export interface VisualPlan {
  topic: string
  lesson_outline: string
  key_terms: string[]
  visuals: VisualSpec[]
  explanation_guidance?: string
}

// ── Layout constants ─────────────────────────────────────────────

const FRAME = {
  WIDTH: 800,
  HEIGHT: 1100,
  PAD: 50,       // inner padding
  GAP: 60,       // gap between frames in the grid
  COLS: 4,
}

/** Content area inside a frame */
const CONTENT = {
  get W() { return FRAME.WIDTH - 2 * FRAME.PAD },
  get LEFT() { return FRAME.PAD },
  TOP: 80,  // below title
}

// ── Main builder ─────────────────────────────────────────────────

export class DiagramBuilder {
  private editor: Editor
  private frameId: TLShapeId
  private frameX: number
  private frameY: number
  private createdShapeIds: TLShapeId[] = []

  constructor(editor: Editor, frameId: TLShapeId, frameX: number, frameY: number) {
    this.editor = editor
    this.frameId = frameId
    this.frameX = frameX
    this.frameY = frameY
  }

  /** Build all visuals from a plan, stacked vertically inside the frame. */
  buildAll(visuals: VisualSpec[]): TLShapeId[] {
    let yOffset = CONTENT.TOP

    for (let i = 0; i < visuals.length; i++) {
      const spec = visuals[i]
      const figLabel = `Figure ${i + 1}`

      // Figure label
      this.createText(figLabel, CONTENT.LEFT, yOffset - 24, {
        size: 's',
        color: 'grey',
        autoSize: true,
      })

      const height = this.buildVisual(spec, yOffset)
      yOffset += height + 60 // gap between diagrams
    }

    // Expand frame if content overflows
    if (yOffset > FRAME.HEIGHT - FRAME.PAD) {
      try {
        this.editor.updateShape({
          id: this.frameId,
          type: 'frame',
          props: { h: yOffset + FRAME.PAD },
        })
      } catch { /* older TLDraw may not support updateShape on frames */ }
    }

    return this.createdShapeIds
  }

  /** Build a single visual. Returns the height consumed. */
  private buildVisual(spec: VisualSpec, startY: number): number {
    const colors = spec.colors || {}

    switch (spec.visual_type) {
      case 'diagram_cycle':
        return this.buildCycle(spec, startY, colors)
      case 'diagram_flow':
        return this.buildFlow(spec, startY, colors)
      case 'diagram_labeled':
        return this.buildLabeled(spec, startY, colors)
      case 'chart_bar':
        return this.buildBarChart(spec, startY, colors)
      case 'comparison':
        return this.buildComparison(spec, startY, colors)
      default:
        return this.buildLabeled(spec, startY, colors)
    }
  }

  // ── Cycle Diagram ────────────────────────────────────────────

  private buildCycle(spec: VisualSpec, startY: number, colors: Record<string, string>): number {
    const n = spec.labels.length
    if (n < 2) return this.buildLabeled(spec, startY, colors)

    const CX = CONTENT.W / 2 + CONTENT.LEFT
    const CY = startY + 280
    const R = Math.min(200, CONTENT.W / 2 - 80)
    const NODE_W = 120
    const NODE_H = 60

    // Title
    this.createText(spec.title, CX - 150, startY, {
      size: 'l',
      autoSize: false,
      w: 300,
    })

    // Calculate node positions (clockwise from top)
    const nodeIds: TLShapeId[] = []
    const nodePositions: Array<{ x: number; y: number }> = []

    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
      const nx = CX + R * Math.cos(angle) - NODE_W / 2
      const ny = CY + R * Math.sin(angle) - NODE_H / 2
      nodePositions.push({ x: nx, y: ny })

      const id = this.createGeo(spec.labels[i], nx, ny, NODE_W, NODE_H, {
        geo: 'ellipse',
        color: pickColor(i, colors, spec.labels[i]),
        fill: 'semi',
      })
      nodeIds.push(id)
    }

    // Arrows: connect each node to the next (wrapping around)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      this.createArrow(
        nodeIds[i], nodeIds[j],
        pickColor(i, colors, spec.labels[i]),
      )
    }

    return 280 + R + NODE_H / 2 + 20
  }

  // ── Flow Diagram ─────────────────────────────────────────────

  private buildFlow(spec: VisualSpec, startY: number, colors: Record<string, string>): number {
    const n = spec.labels.length
    const BOX_W = Math.min(300, CONTENT.W * 0.6)
    const BOX_H = 50
    const GAP = 50
    const LEFT = CONTENT.LEFT + (CONTENT.W - BOX_W) / 2

    // Title
    this.createText(spec.title, LEFT, startY, {
      size: 'l',
      autoSize: false,
      w: BOX_W,
    })

    const nodeIds: TLShapeId[] = []
    let y = startY + 44

    for (let i = 0; i < n; i++) {
      const isEnd = i === 0 || i === n - 1
      const id = this.createGeo(spec.labels[i], LEFT, y, BOX_W, BOX_H, {
        geo: isEnd ? 'diamond' : 'rectangle',
        color: pickColor(i, colors, spec.labels[i]),
        fill: 'semi',
      })
      nodeIds.push(id)
      y += BOX_H + GAP
    }

    // Arrows between consecutive nodes
    for (let i = 0; i < n - 1; i++) {
      this.createArrow(nodeIds[i], nodeIds[i + 1], pickColor(i, colors, spec.labels[i]))
    }

    return 44 + n * (BOX_H + GAP)
  }

  // ── Labeled Diagram ──────────────────────────────────────────

  private buildLabeled(spec: VisualSpec, startY: number, colors: Record<string, string>): number {
    const n = spec.labels.length
    const CX = CONTENT.W / 2 + CONTENT.LEFT
    const CY = startY + 260
    const CORE_W = 140
    const CORE_H = 80
    const R = Math.min(220, CONTENT.W / 2 - 70)
    const LABEL_W = 110
    const LABEL_H = 44

    // Title
    this.createText(spec.title, CX - 150, startY, {
      size: 'l',
      autoSize: false,
      w: 300,
    })

    // Central shape
    const centerId = this.createGeo(
      spec.title.length > 18 ? spec.title.slice(0, 18) : spec.title,
      CX - CORE_W / 2, CY - CORE_H / 2, CORE_W, CORE_H,
      { geo: 'rectangle', color: 'grey', fill: 'solid' },
    )

    // Radial label shapes + arrows from center
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
      const lx = CX + R * Math.cos(angle) - LABEL_W / 2
      const ly = CY + R * Math.sin(angle) - LABEL_H / 2

      const labelId = this.createGeo(spec.labels[i], lx, ly, LABEL_W, LABEL_H, {
        geo: 'rectangle',
        color: pickColor(i, colors, spec.labels[i]),
        fill: 'semi',
      })

      this.createArrow(centerId, labelId, pickColor(i, colors, spec.labels[i]))
    }

    return 260 + R + LABEL_H / 2 + 40
  }

  // ── Bar Chart ────────────────────────────────────────────────

  private buildBarChart(spec: VisualSpec, startY: number, colors: Record<string, string>): number {
    const n = spec.labels.length
    // Extract values from connections
    const valMap = new Map<string, number>()
    for (const conn of spec.connections) {
      if (conn.value !== undefined) valMap.set(conn.from, conn.value)
    }
    const values = spec.labels.map((l, i) => valMap.get(l) ?? (i + 1) * 20)
    const maxVal = Math.max(...values, 1)

    const CHART_H = 300
    const BAR_GAP = 20
    const AVAILABLE_W = CONTENT.W - 60
    const BAR_W = Math.min(80, (AVAILABLE_W - BAR_GAP * (n + 1)) / n)
    const BASE_Y = startY + CHART_H + 50

    // Title
    this.createText(spec.title, CONTENT.LEFT, startY, {
      size: 'l',
      autoSize: false,
      w: CONTENT.W,
    })

    // Bars
    for (let i = 0; i < n; i++) {
      const barH = Math.max(20, (values[i] / maxVal) * CHART_H * 0.85)
      const bx = CONTENT.LEFT + 40 + BAR_GAP * (i + 1) + BAR_W * i
      const by = BASE_Y - barH

      // Bar rectangle
      this.createGeo('', bx, by, BAR_W, barH, {
        geo: 'rectangle',
        color: pickColor(i, colors, spec.labels[i]),
        fill: 'solid',
      })

      // Value label above bar
      this.createText(String(values[i]), bx, by - 22, {
        size: 's',
        autoSize: true,
      })

      // Category label below bar
      this.createText(spec.labels[i], bx - 10, BASE_Y + 8, {
        size: 's',
        autoSize: true,
      })
    }

    // Baseline
    this.createGeo('', CONTENT.LEFT + 30, BASE_Y, AVAILABLE_W, 2, {
      geo: 'rectangle',
      color: 'grey',
      fill: 'solid',
    })

    return CHART_H + 100
  }

  // ── Comparison ───────────────────────────────────────────────

  private buildComparison(spec: VisualSpec, startY: number, colors: Record<string, string>): number {
    const mid = Math.ceil(spec.labels.length / 2)
    const left = spec.labels.slice(0, mid)
    const right = spec.labels.slice(mid)
    const nRows = Math.max(left.length, right.length)

    const COL_W = (CONTENT.W - 40) / 2
    const ROW_H = 50
    const ROW_GAP = 12

    // Title
    this.createText(spec.title, CONTENT.LEFT, startY, {
      size: 'l',
      autoSize: false,
      w: CONTENT.W,
    })

    // Column headers
    this.createText(left[0] || 'A', CONTENT.LEFT, startY + 40, {
      size: 'm', autoSize: true, color: 'blue',
    })
    this.createText(right[0] || 'B', CONTENT.LEFT + COL_W + 40, startY + 40, {
      size: 'm', autoSize: true, color: 'red',
    })

    let y = startY + 72

    for (let i = 0; i < nRows; i++) {
      if (i < left.length) {
        this.createGeo(left[i], CONTENT.LEFT, y, COL_W, ROW_H - 4, {
          geo: 'rectangle', color: 'blue', fill: 'semi',
        })
      }
      if (i < right.length) {
        this.createGeo(right[i], CONTENT.LEFT + COL_W + 40, y, COL_W, ROW_H - 4, {
          geo: 'rectangle', color: 'red', fill: 'semi',
        })
      }
      y += ROW_H + ROW_GAP
    }

    return 72 + nRows * (ROW_H + ROW_GAP) + 20
  }

  // ── Shape creation helpers ───────────────────────────────────

  /** Create a geo shape (rectangle, ellipse, diamond) with text inside. */
  private createGeo(
    text: string,
    x: number, y: number,
    w: number, h: number,
    opts: {
      geo?: string
      color?: TLColor
      fill?: string
    } = {},
  ): TLShapeId {
    const id = createShapeId()
    this.editor.createShape({
      id,
      type: 'geo',
      parentId: this.frameId,
      x,
      y,
      props: {
        geo: opts.geo || 'rectangle',
        w,
        h,
        text: text,
        color: opts.color || 'blue',
        fill: opts.fill || 'semi',
        size: 's',
        font: 'sans',
        align: 'middle',
        verticalAlign: 'middle',
      } as any,
    })
    this.createdShapeIds.push(id)
    return id
  }

  /** Create a text shape. Uses autoSize:false + w by default for wrapping. */
  private createText(
    text: string,
    x: number, y: number,
    opts: {
      size?: string
      autoSize?: boolean
      w?: number
      color?: string
    } = {},
  ): TLShapeId {
    const id = createShapeId()
    const props: Record<string, any> = {
      text,
      size: opts.size || 'm',
      font: 'sans',
      color: opts.color || 'black',
    }

    if (opts.autoSize === true) {
      props.autoSize = true
    } else {
      // Default: wrap text within specified or full content width
      props.autoSize = false
      props.w = opts.w || CONTENT.W
    }

    this.editor.createShape({
      id,
      type: 'text',
      parentId: this.frameId,
      x,
      y,
      props,
    })
    this.createdShapeIds.push(id)
    return id
  }

  /** Create an arrow between two shapes using TLDraw bindings. */
  private createArrow(fromId: TLShapeId, toId: TLShapeId, color: TLColor = 'grey'): TLShapeId {
    const id = createShapeId()

    // Get center positions of from/to shapes for arrow placement
    const fromShape = this.editor.getShape(fromId) as any
    const toShape = this.editor.getShape(toId) as any

    if (!fromShape || !toShape) return id

    const fromCX = fromShape.x + (fromShape.props?.w || 60) / 2
    const fromCY = fromShape.y + (fromShape.props?.h || 40) / 2
    const toCX = toShape.x + (toShape.props?.w || 60) / 2
    const toCY = toShape.y + (toShape.props?.h || 40) / 2

    this.editor.createShape({
      id,
      type: 'arrow',
      parentId: this.frameId,
      x: fromCX,
      y: fromCY,
      props: {
        color,
        size: 's',
        start: { x: 0, y: 0 },
        end: { x: toCX - fromCX, y: toCY - fromCY },
        arrowheadEnd: 'arrow',
        arrowheadStart: 'none',
      } as any,
    })

    // Try to bind arrow endpoints to shapes (TLDraw v2)
    try {
      this.editor.createBindings([
        {
          type: 'arrow',
          fromId: id,
          toId: fromId,
          props: {
            terminal: 'start',
            isExact: false,
            isPrecise: false,
            normalizedAnchor: { x: 0.5, y: 0.5 },
          },
        } as any,
        {
          type: 'arrow',
          fromId: id,
          toId: toId,
          props: {
            terminal: 'end',
            isExact: false,
            isPrecise: false,
            normalizedAnchor: { x: 0.5, y: 0.5 },
          },
        } as any,
      ])
    } catch {
      // Bindings API may differ across TLDraw versions — arrow still works positionally
    }

    this.createdShapeIds.push(id)
    return id
  }
}


/**
 * Build a full visual plan inside a new A4 frame.
 * Returns the frame ID and all created shape IDs.
 */
export function buildDiagramFrame(
  editor: Editor,
  plan: VisualPlan,
  slotIndex: number,
): { frameId: TLShapeId; shapeIds: TLShapeId[] } {
  // Calculate frame position in the grid
  const col = slotIndex % FRAME.COLS
  const row = Math.floor(slotIndex / FRAME.COLS)
  const fx = col * (FRAME.WIDTH + FRAME.GAP)
  const fy = row * (FRAME.HEIGHT + FRAME.GAP)

  // Create the A4 frame
  const frameId = createShapeId()
  editor.createShape({
    id: frameId,
    type: 'frame',
    x: fx,
    y: fy,
    props: {
      w: FRAME.WIDTH,
      h: FRAME.HEIGHT,
      name: plan.topic || 'Diagram',
    },
  })

  // Build diagrams inside the frame
  const builder = new DiagramBuilder(editor, frameId, fx, fy)
  const shapeIds = builder.buildAll(plan.visuals)

  return { frameId, shapeIds: [frameId, ...shapeIds] }
}
