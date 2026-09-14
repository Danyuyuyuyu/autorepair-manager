import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  Calendar,
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Eye,
  EyeOff,
  Filter,
  Home,
  Info,
  Inbox,
  Loader2,
  LogOut,
  MapPin,
  MoreHorizontal,
  Package,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  Shield,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserCircle,
  Users,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * 图标映射表。
 * 只在这里集中登记图标，好处是图标名写错会在编译期报错，
 * 也避免每个组件各自 import 一堆图标导致打包体积膨胀。
 */
export const ICONS = {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  Calendar,
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Eye,
  EyeOff,
  Filter,
  Home,
  Info,
  Inbox,
  Loader2,
  LogOut,
  MapPin,
  MoreHorizontal,
  Package,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  Shield,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserCircle,
  Users,
  Wallet,
  Wrench,
  X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  className,
  strokeWidth,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  const Component = ICONS[name];
  return <Component className={className} strokeWidth={strokeWidth} aria-hidden />;
}
