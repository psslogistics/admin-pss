import { Activity, AlertTriangle, ArrowRight, ArrowUpRight, BarChart3, Bell, BookOpenCheck, Boxes, Building2, CalendarClock, ChartNoAxesCombined, Check, CheckCircle2, ClipboardCheck, ContactRound, CreditCard, FileBarChart, FileText, Headphones, LayoutDashboard, LifeBuoy, ListChecks, MessageSquare, Package, PackagePlus, PackageSearch, RadioTower, ReceiptIndianRupee, RotateCcw, Settings, ShieldAlert, ShieldCheck, ShieldEllipsis, TicketCheck, Truck, UserRound, UserRoundCheck, UsersRound, WalletCards, Webhook, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const iconRegistry = {
  dashboard: LayoutDashboard, attention: AlertTriangle, shipments: Boxes, bookings: BookOpenCheck, tracking: PackageSearch, pickups: Truck, returns: RotateCcw, exceptions: AlertTriangle,
  clients: Building2, onboarding: ContactRound, assignments: UserRoundCheck, clientActivity: Activity, employees: UsersRound, departments: Building2, roles: ShieldCheck, tasks: ListChecks, employeeActivity: ClipboardCheck,
  support: Headphones, help: LifeBuoy, conversation: MessageSquare, sla: CalendarClock, wallets: WalletCards, billing: ReceiptIndianRupee, transactions: CreditCard, analytics: ChartNoAxesCombined, reports: FileBarChart, performance: BarChart3,
  workflow: Workflow, notificationRules: MessageSquare, scheduledJobs: CalendarClock, courierIntegrations: Truck, channels: RadioTower, webhooks: Webhook, auditLogs: Activity, security: ShieldEllipsis, notifications: Bell, settings: Settings,
  shipment: Package, createShipment: PackagePlus, warning: AlertTriangle, issue: ShieldAlert, selected: Check, completed: CheckCircle2, resolvedTicket: TicketCheck, next: ArrowRight, openDetail: ArrowUpRight, user: UserRound, file: FileText,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof iconRegistry;
