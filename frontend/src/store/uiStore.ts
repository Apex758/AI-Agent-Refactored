import { create } from 'zustand'
import type { UIMode } from '@/components/whiteboard/types'

interface UIStore {
  mode: UIMode
  setMode: (mode: UIMode) => void
  locked: boolean
  toggleLock: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  mode: 'chat',
  setMode: (mode) => set({ mode }),
  locked: false,
  toggleLock: () => set((state) => ({ locked: !state.locked })),
}))