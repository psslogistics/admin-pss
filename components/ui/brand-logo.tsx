import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandLogo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return <span className={cn("inline-flex items-center justify-center overflow-hidden rounded-md bg-white", compact ? "h-8 w-8 p-1" : "h-10 w-[148px] px-2 py-1.5", className)}><Image src={compact ? "/pss-mark.png" : "/pss-logo.png"} alt="PSS Logistics" width={compact ? 32 : 148} height={compact ? 32 : 42} priority className="h-auto w-full object-contain" /></span>;
}
