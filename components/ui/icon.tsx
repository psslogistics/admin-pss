import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";
import { iconRegistry, type IconName } from "@/lib/iconography";

const sizeClasses = { sm: "size-3.5", md: "size-4", lg: "size-[18px]", xl: "size-5", hero: "size-6" } as const;
const toneClasses = { inherit: "", muted: "text-muted-foreground", primary: "text-primary", success: "text-emerald-600 dark:text-emerald-400", warning: "text-amber-600 dark:text-amber-400", danger: "text-destructive" } as const;

export type PssIconProps = Omit<ComponentPropsWithoutRef<"svg">, "children"> & { name: IconName; size?: keyof typeof sizeClasses; tone?: keyof typeof toneClasses; label?: string; decorative?: boolean; strokeWidth?: number };

export function PssIcon({ name, size = "md", tone = "inherit", label, decorative = true, strokeWidth = 1.9, className, ...props }: PssIconProps) {
  const Icon = iconRegistry[name];
  return <Icon aria-hidden={decorative ? true : undefined} aria-label={label} className={cn(sizeClasses[size], toneClasses[tone], className)} strokeWidth={strokeWidth} {...props} />;
}
