'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────
interface MilestoneData {
  milestone_id: string
  title: string
  description: string
  order: number
  status: 'locked' | 'available' | 'in_progress' | 'checking' | 'mastered' | 'needs_review'
  attempts: number
  recent_accuracy?: number
}

interface MilestonePlan {
  plan_id: string
  topic: string
  subject: string
  progress: number
  milestones: MilestoneData[]
}

interface MilestoneBarProps {
  chatId: string
}

// ── Status config ─────────────────────────────────────────────────
const STATUS = {
  mastered:     { emoji: '✅', color: '#22c55e', label: 'Mastered' },
  in_progress:  { emoji: '🔵', color: '#3b82f6', label: 'In Progress' },
  checking:     { emoji: '🟡', color: '#eab308', label: 'Checking' },
  available:    { emoji: '⬜', color: '#d1d5db', label: 'Available' },
  locked:       { emoji: '🔒', color: '#6b7280', label: 'Locked' },
  needs_review: { emoji: '🔴', color: '#ef4444', label: 'Needs Review' },
} as const

// ── Topic detect prompt helper (sent via existing WS) ─────────────
function detectTopic(message: string): string | null {
  const m = message.match(/(?:learn|understand|study|explain|teach me|how (?:do|does)|what is|what are)\s+(?:about\s+)?(.{3,60})(?:\?|$|\.)/i)
  return m ? m[1].trim().replace(/[?!.,;]$/, '') : null
}

// ── MilestoneBar ──────────────────────────────────────────────────
export default function MilestoneBar({ chatId }: MilestoneBarProps) {
  const [plans, setPlans]         = useState<MilestonePlan[]>([])
  const [expanded, setExpanded]   = useState(false)
  const [activePlan, setActivePlan] = useState<MilestonePlan | null>(null)
  const [addingTopic, setAddingTopic] = useState(false)
  const [newTopic, setNewTopic]   = useState('')
  const [loading, setLoading]     = useState(false)

  // Load all plans for current chat
  const loadPlans = useCallback(async () => {
    if (!chatId) return
    try {
      const res = await fetch(`/api/milestones/chat/${chatId}`)
      const data = await res.json()
      const loaded: MilestonePlan[] = (data.plans || []).map((p: any) => ({
        ...p,
        progress: p.milestones.filter((m: any) => m.status === 'mastered').length / Math.max(p.milestones.length, 1),
      }))
      setPlans(loaded)
      if (!activePlan && loaded.length > 0) setActivePlan(loaded[0])
    } catch {}
  }, [chatId, activePlan])

  useEffect(() => { loadPlans() }, [chatId])

  // Refresh active plan
  const refreshPlan = useCallback(async (planId: string) => {
    try {
      const res = await fetch(`/api/milestones/${planId}`)
      const data = await res.json()
      const updated = {
        ...data,
        progress: data.milestones.filter((m: any) => m.status === 'mastered').length / Math.max(data.milestones.length, 1),
      }
      setPlans(prev => prev.map(p => p.plan_id === planId ? updated : p))
      setActivePlan(updated)
    } catch {}
  }, [])

  const createPlan = useCallback(async (topic: string) => {
    if (!topic.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, topic: topic.trim(), subject: 'General' }),
      })
      const plan = await res.json()
      const enriched = {
        ...plan,
        progress: plan.milestones.filter((m: any) => m.status === 'mastered').length / Math.max(plan.milestones.length, 1),
      }
      setPlans(prev => [enriched, ...prev.filter(p => p.plan_id !== enriched.plan_id)])
      setActivePlan(enriched)
      setExpanded(true)
    } catch {}
    setLoading(false)
    setAddingTopic(false)
    setNewTopic('')
  }, [chatId])

  const markCheck = useCallback(async (correct: boolean) => {
    if (!activePlan) return
    try {
      const res = await fetch(`/api/milestones/${activePlan.plan_id}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct }),
      })
      const updated = await res.json()
      const enriched = {
        ...updated,
        progress: updated.milestones.filter((m: any) => m.status === 'mastered').length / Math.max(updated.milestones.length, 1),
      }
      setPlans(prev => prev.map(p => p.plan_id === enriched.plan_id ? enriched : p))
      setActivePlan(enriched)
    } catch {}
  }, [activePlan])

  const advance = useCallback(async () => {
    if (!activePlan) return
    try {
      const res = await fetch(`/api/milestones/${activePlan.plan_id}/advance`, { method: 'POST' })
      const updated = await res.json()
      const enriched = {
        ...updated,
        progress: updated.milestones.filter((m: any) => m.status === 'mastered').length / Math.max(updated.milestones.length, 1),
      }
      setPlans(prev => prev.map(p => p.plan_id === enriched.plan_id ? enriched : p))
      setActivePlan(enriched)
    } catch {}
  }, [activePlan])

  const deletePlan = useCallback(async (planId: string) => {
    try {
      await fetch(`/api/milestones/${planId}`, { method: 'DELETE' })
      const remaining = plans.filter(p => p.plan_id !== planId)
      setPlans(remaining)
      if (activePlan?.plan_id === planId) setActivePlan(remaining[0] || null)
    } catch {}
  }, [plans, activePlan])

  const pct = activePlan ? Math.round(activePlan.progress * 100) : 0
  const currentMilestone = activePlan?.milestones.find(
    m => m.status === 'in_progress' || m.status === 'checking' || m.status === 'available'
  )

  // ── Bar (collapsed state) ──────────────────────────────────────
  const barH = 200 // px height of the bar
  const fillH = Math.round((pct / 100) * barH)

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 56,
        right: 16,
        zIndex: 600,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
        pointerEvents: 'auto',
      }}
    >
      {/* ── Expanded panel ── */}
      {expanded && (
        <div
          style={{
            width: 280,
            maxHeight: 480,
            overflowY: 'auto',
            background: 'rgba(15,23,42,0.95)',
            border: '1.5px solid rgba(34,197,94,0.4)',
            borderRadius: 14,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            padding: 14,
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>
              🎮 Milestone Tracker
            </span>
            <button
              onClick={() => setExpanded(false)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}
            >×</button>
          </div>

          {/* Topic tabs */}
          {plans.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
              {plans.map(p => (
                <button
                  key={p.plan_id}
                  onClick={() => setActivePlan(p)}
                  style={{
                    fontSize: 10,
                    padding: '3px 8px',
                    borderRadius: 99,
                    border: `1px solid ${activePlan?.plan_id === p.plan_id ? '#22c55e' : 'rgba(255,255,255,.15)'}`,
                    background: activePlan?.plan_id === p.plan_id ? 'rgba(34,197,94,.15)' : 'transparent',
                    color: activePlan?.plan_id === p.plan_id ? '#22c55e' : '#94a3b8',
                    cursor: 'pointer',
                    maxWidth: 120,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={p.topic}
                >
                  {p.topic}
                </button>
              ))}
            </div>
          )}

          {/* Active plan */}
          {activePlan ? (
            <>
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  {activePlan.topic}
                </div>
                {/* Progress bar */}
                <div style={{ height: 6, background: 'rgba(255,255,255,.1)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#16a34a,#22c55e)', borderRadius: 99, transition: 'width 0.4s' }} />
                </div>
                <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 3 }}>{pct}% complete</div>
              </div>

              {/* Milestones list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {activePlan.milestones.map((m, i) => {
                  const cfg = STATUS[m.status] || STATUS.locked
                  const isCurrent = m.status === 'in_progress' || (m.status === 'available' && !activePlan.milestones.some(x => x.status === 'in_progress'))
                  return (
                    <div
                      key={m.milestone_id}
                      style={{
                        display: 'flex',
                        gap: 8,
                        padding: '7px 9px',
                        borderRadius: 9,
                        background: isCurrent ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)',
                        border: isCurrent ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent',
                      }}
                    >
                      <span style={{ fontSize: 14, flexShrink: 0, lineHeight: '20px' }}>{cfg.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          color: m.status === 'locked' ? '#4b5563' : '#e2e8f0',
                          fontSize: 12,
                          fontWeight: isCurrent ? 600 : 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {m.order}. {m.title}
                        </div>
                        {isCurrent && (
                          <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 2 }}>{m.description}</div>
                        )}
                        {m.attempts > 0 && (
                          <div style={{ color: '#6b7280', fontSize: 10 }}>
                            {m.attempts} attempt{m.attempts !== 1 ? 's' : ''} · {Math.round((m.recent_accuracy || 0) * 100)}% acc
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Check buttons (for current milestone) */}
              {currentMilestone && activePlan.progress < 1 && (
                <div>
                  <div style={{ color: '#64748b', fontSize: 10, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    Record check
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => markCheck(true)}
                      style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: 'none', background: 'rgba(34,197,94,.2)', color: '#22c55e', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                    >
                      ✓ Got it
                    </button>
                    <button
                      onClick={() => markCheck(false)}
                      style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: 'none', background: 'rgba(239,68,68,.15)', color: '#f87171', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                    >
                      ✗ Not yet
                    </button>
                  </div>
                  <button
                    onClick={advance}
                    style={{ marginTop: 5, width: '100%', padding: '5px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}
                  >
                    Skip → next level
                  </button>
                </div>
              )}

              {activePlan.progress === 1 && (
                <div style={{ textAlign: 'center', color: '#22c55e', fontSize: 13, fontWeight: 700, padding: '8px 0' }}>
                  🎉 Topic mastered!
                </div>
              )}

              <button
                onClick={() => deletePlan(activePlan.plan_id)}
                style={{ marginTop: 8, width: '100%', padding: '4px 0', borderRadius: 7, border: 'none', background: 'transparent', color: '#374151', fontSize: 10, cursor: 'pointer' }}
              >
                Remove this topic
              </button>
            </>
          ) : (
            <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
              No topics yet. Add one below ↓
            </div>
          )}

          {/* Add topic */}
          {addingTopic ? (
            <div style={{ marginTop: 8, display: 'flex', gap: 5 }}>
              <input
                autoFocus
                value={newTopic}
                onChange={e => setNewTopic(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createPlan(newTopic); if (e.key === 'Escape') setAddingTopic(false) }}
                placeholder="e.g. Fractions"
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(34,197,94,.4)',
                  background: 'rgba(255,255,255,.05)', color: '#e2e8f0', fontSize: 12, outline: 'none',
                }}
              />
              <button
                onClick={() => createPlan(newTopic)}
                disabled={loading}
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontSize: 12, cursor: 'pointer' }}
              >
                {loading ? '…' : '→'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingTopic(true)}
              style={{ marginTop: 8, width: '100%', padding: '6px 0', borderRadius: 8, border: '1px dashed rgba(34,197,94,.3)', background: 'transparent', color: '#4ade80', fontSize: 11, cursor: 'pointer' }}
            >
              + Add topic to track
            </button>
          )}
        </div>
      )}

      {/* ── Vertical green bar ── */}
      <div
        onClick={() => setExpanded(o => !o)}
        title={`${pct}% — Click to expand milestone tracker`}
        style={{
          width: 18,
          height: barH,
          background: 'rgba(15,23,42,0.85)',
          border: '1.5px solid rgba(34,197,94,0.35)',
          borderRadius: 99,
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: expanded ? '0 0 16px rgba(34,197,94,0.4)' : '0 4px 16px rgba(0,0,0,0.4)',
          transition: 'box-shadow 0.2s',
        }}
      >
        {/* Fill */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: fillH,
            background: 'linear-gradient(180deg, #22c55e 0%, #16a34a 100%)',
            borderRadius: 99,
            transition: 'height 0.5s cubic-bezier(0.34,1.56,0.64,1)',
          }}
        />

        {/* Milestone tick marks */}
        {activePlan?.milestones.map((m, i) => {
          const total = activePlan.milestones.length
          const posFromBottom = ((i + 1) / total) * barH
          const isMastered = m.status === 'mastered'
          return (
            <div
              key={m.milestone_id}
              style={{
                position: 'absolute',
                bottom: posFromBottom - 1,
                left: 2,
                right: 2,
                height: 2,
                background: isMastered ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)',
                borderRadius: 1,
              }}
            />
          )
        })}

        {/* Percentage label */}
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: pct > 20 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)',
            fontSize: 8,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {pct}
        </div>
      </div>
    </div>
  )
}

// Export topic detector for external use
export { detectTopic }
