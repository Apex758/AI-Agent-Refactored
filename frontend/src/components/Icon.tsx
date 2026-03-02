'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  File02Icon,
  GlobeIcon,
  FolderOpenIcon,
  Attachment01Icon,
  Remove01Icon,
  RecordIcon,
  StopIcon,
  Speaker01Icon,
  VolumeMute01Icon,
  VolumeLowIcon,
  Chat01Icon,
  PaintBoardIcon,
  Camera01Icon,
  Video01Icon,
  PlayIcon,
  ArrowUpRight01Icon,
  Edit01Icon,
  Menu01Icon,
  PinIcon,
} from '@hugeicons/core-free-icons'

export type IconName =
  | 'file-text'
  | 'globe'
  | 'folder-open'
  | 'paperclip'
  | 'close'
  | 'microphone'
  | 'stop'
  | 'speaker'
  | 'speaker-mute'
  | 'speaker-low'
  | 'chat'
  | 'palette'
  | 'camera'
  | 'video'
  | 'play'
  | 'arrow-up-right'
  | 'edit'
  | 'menu'
  | 'pin'

const iconMap: Record<IconName, typeof File02Icon> = {
  'file-text': File02Icon,
  'globe': GlobeIcon,
  'folder-open': FolderOpenIcon,
  'paperclip': Attachment01Icon,
  'close': Remove01Icon,
  'microphone': RecordIcon,
  'stop': StopIcon,
  'speaker': Speaker01Icon,
  'speaker-mute': VolumeMute01Icon,
  'speaker-low': VolumeLowIcon,
  'chat': Chat01Icon,
  'palette': PaintBoardIcon,
  'camera': Camera01Icon,
  'video': Video01Icon,
  'play': PlayIcon,
  'arrow-up-right': ArrowUpRight01Icon,
  'edit': Edit01Icon,
  'menu': Menu01Icon,
  'pin': PinIcon,
}

interface IconProps {
  name: IconName
  size?: number
  color?: string
  className?: string
}

export default function Icon({ name, size = 16, color = 'currentColor', className }: IconProps) {
  const icon = iconMap[name]
  
  if (!icon) {
    console.warn(`Icon "${name}" not found`)
    return null
  }

  return (
    <span 
      className={className} 
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <HugeiconsIcon icon={icon} size={size} color={color} strokeWidth={1.5} />
    </span>
  )
}