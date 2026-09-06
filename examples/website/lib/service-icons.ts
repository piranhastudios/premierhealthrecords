import {
  Activity,
  Baby,
  Bone,
  Brain,
  ClipboardList,
  Droplet,
  Eye,
  Heart,
  HeartPulse,
  Microscope,
  Pill,
  Scan,
  Sparkles,
  Stethoscope,
  Users,
  type LucideIcon,
} from "lucide-react"

/** Keys match the `icon` options on the Sanity `service` document. */
const icons: Record<string, LucideIcon> = {
  stethoscope: Stethoscope,
  heart: Heart,
  heartPulse: HeartPulse,
  baby: Baby,
  bone: Bone,
  brain: Brain,
  eye: Eye,
  sparkles: Sparkles,
  droplet: Droplet,
  activity: Activity,
  clipboardList: ClipboardList,
  users: Users,
  pill: Pill,
  scan: Scan,
  microscope: Microscope,
}

export function serviceIcon(key?: string | null): LucideIcon {
  return icons[key ?? "stethoscope"] ?? Stethoscope
}
