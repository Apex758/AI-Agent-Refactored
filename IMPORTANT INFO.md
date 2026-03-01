**Personal use:** SQLite is fine. No Redis needed — you're one user, one process, no concurrency problems.

**Multi-user (Claude-style):** Whole stack changes. The five things you'd need to swap:

- **SQLite → PostgreSQL** — handles concurrent writes
- **Python dict → Redis** — shared WebSocket/session state across workers
- **numpy search → pgvector** — scales across thousands of users' memories
- **client_id string → JWT auth** — right now anyone can impersonate any user
- **await in request cycle → Celery** — memory capture/naming currently blocks the response

The core logic (`Gateway`, `MemoryManager`, tools) stays the same. The biggest rewrite is `manager.py` to swap the data layer, plus adding auth middleware. Everything else is config.










# TLDraw Whiteboard Integration — Implementation Guide

## Install

```bash
cd frontend
npm install tldraw@^2.4.0
```

## Files to ADD (copy these into your project)

```
frontend/src/
├── store/
│   ├── uiStore.ts              ← NEW: chat/whiteboard mode toggle
│   └── whiteboardStore.ts      ← NEW: editor ref, snapshots, export, scenePlan
├── components/
│   ├── CenterStage.tsx         ← NEW: wrapper with toggle header + stacked layers
│   ├── FloatingMic.tsx         ← NEW: floating mic for whiteboard mode
│   └── whiteboard/
│       ├── types.ts            ← NEW: ScenePlan + UIMode types
│       ├── Whiteboard.tsx      ← NEW: TLDraw client component
│       └── WhiteboardLayer.tsx ← NEW: wraps Whiteboard + snapshot button
└── types/
    └── index.ts                ← REPLACE: adds Attachment, VoiceState
```

## Files to REPLACE

| File | What changed |
|---|---|
| `src/types/index.ts` | Added `Attachment`, `VoiceState` interfaces; added `attachment?` to `Message`; added `voiceState` + `setVoiceState` to `ChatStore` |
| `src/store/chatStore.ts` | Added `voiceState` initial state + `setVoiceState` action |
| `src/app/page.tsx` | Center area now wrapped in `<CenterStage>`. Chat content is passed as children. Header split into `headerLeft`/`headerRight` props. Added attachment image rendering in message bubbles. |
| `package.json` | Added `"tldraw": "^2.4.0"` to dependencies |

## CSS — append to `globals.css`

Add the contents of `css-additions.css` to the bottom of `frontend/src/app/globals.css`.

## Architecture

```
┌──────────┬───────────────────────────────────┬──────────┐
│          │         CenterStage               │          │
│  Left    │  ┌─ Header (toggle + controls) ─┐ │  Right   │
│  Sidebar │  │  [💬 Chat] [🎨 Board]        │ │  Panel   │
│          │  ├──────────────────────────────┤ │          │
│          │  │ ┌── ChatLayer ────────────┐  │ │          │
│          │  │ │ opacity: mode=chat?1:0  │  │ │          │
│          │  │ │ (always mounted)        │  │ │          │
│          │  │ └─────────────────────────┘  │ │          │
│          │  │ ┌── WhiteboardLayer ──────┐  │ │          │
│          │  │ │ opacity: mode=wb?1:0    │  │ │          │
│          │  │ │ (always mounted)        │  │ │          │
│          │  │ │ ┌─ TLDraw ───────────┐ │  │ │          │
│          │  │ │ │                     │ │  │ │          │
│          │  │ │ └─────────────────────┘ │  │ │          │
│          │  │ │ [📸 Send to Chat]       │  │ │          │
│          │  │ │ [🎙️ Floating Mic]       │  │ │          │
│          │  │ └─────────────────────────┘  │ │          │
│          │  └──────────────────────────────┘ │          │
└──────────┴───────────────────────────────────┴──────────┘
```

## Key Behaviors

1. **Both layers always mounted** — switching only toggles `opacity` and `pointer-events`
2. **Chat updates in background** — WebSocket keeps working when whiteboard is shown
3. **Whiteboard state persists per chat** — snapshots saved in memory keyed by chatId
4. **Snapshot to chat** — exports board as PNG, adds as attachment message to chat history
5. **Floating mic** — reuses existing `useVoice` hook, appears in whiteboard mode
6. **`whiteboard_present(scenePlan)`** — places text/images on canvas using normalized [0..1] coordinates

## Using `whiteboard_present()` (future LLM integration)

```ts
import { useWhiteboardStore } from '@/store/whiteboardStore'

// From anywhere in the app:
const { presentOnBoard } = useWhiteboardStore.getState()

presentOnBoard({
  elements: [
    { id: 'title', type: 'text', x: 0.1, y: 0.05, w: 0.8, h: 0.1, text: 'Lesson Plan', fontSize: 36 },
    { id: 'img1', type: 'image', x: 0.2, y: 0.2, w: 0.6, h: 0.4, url: 'https://...' },
    { id: 'note', type: 'text', x: 0.1, y: 0.7, w: 0.8, h: 0.1, text: 'Key points...' },
  ],
  snap: true,
  gridSize: 50,
})
```

## Testing

1. `cd frontend && npm install && npm run dev`
2. Open the app → create or select a chat
3. Click **🎨 Board** toggle → whiteboard appears with fade
4. Draw something on the board
5. Click **💬 Chat** toggle → chat appears, board hidden
6. Click **🎨 Board** again → your drawing is still there
7. Send a chat message while on whiteboard → switch to chat, message is there
8. On whiteboard, click **📸 Send to Chat** → snapshot appears in chat as image
9. Switch chats → each chat has its own whiteboard state
10. Test floating mic on whiteboard → speaks to same LLM pipeline