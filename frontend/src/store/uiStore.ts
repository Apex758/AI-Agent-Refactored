import { create } from 'zustand'
import type { UIMode } from '@/components/whiteboard/types'

interface UIStore {
  mode: UIMode
  setMode: (mode: UIMode) => void
}

export const useUIStore = create<UIStore>((set) => ({
  mode: 'chat',
  setMode: (mode) => set({ mode }),
}))