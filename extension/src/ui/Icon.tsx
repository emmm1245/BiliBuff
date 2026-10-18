// 统一通用图标的语义映射、线宽和尺寸，按需使用 Lucide 组件。
import { ArrowRight, Check, ChevronDown, ChevronRight, Database, Eye, EyeOff, GripVertical, House, ListChecks, MessageSquareText, Server, SlidersHorizontal, Sparkles, TvMinimal, Video, X, type LucideProps } from 'lucide-react';

const icons = {
  tv: TvMinimal,
  rules: ListChecks,
  home: House,
  browse: Sparkles,
  quickRead: MessageSquareText,
  videoAssistant: Video,
  analysis: Sparkles,
  services: Server,
  data: Database,
  preferences: SlidersHorizontal,
  check: Check,
  eye: Eye,
  eyeOff: EyeOff,
  grip: GripVertical,
  arrowRight: ArrowRight,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  close: X,
};

export function Icon({ name, size = 22, ...props }: { name: keyof typeof icons } & LucideProps) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={1.8} aria-hidden="true" focusable="false" {...props} />;
}
