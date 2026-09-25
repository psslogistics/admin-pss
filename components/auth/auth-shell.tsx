import { ArrowUpRight, LockKeyhole, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/ui/brand-logo";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export default function AuthShell({ eyebrow, title, description, children }: AuthShellProps) {
  return (
    <main className="min-h-dvh bg-[#f5f8fc] p-3 text-[#172033] sm:p-5 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-[1380px] overflow-hidden rounded-[28px] border border-[#dbe5f2] bg-white shadow-[0_24px_80px_rgba(23,32,51,0.12)] sm:min-h-[calc(100dvh-2.5rem)] lg:grid-cols-[minmax(0,1.08fr)_minmax(430px,0.92fr)]">
        <section className="relative hidden overflow-hidden bg-[#102642] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
          <div className="absolute -right-28 -top-28 size-[420px] rounded-full bg-[#2563eb]/30 blur-3xl" />
          <div className="absolute -bottom-36 -left-20 size-[420px] rounded-full bg-[#16a5d8]/20 blur-3xl" />
          <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.14)_1px,transparent_1px)] [background-size:42px_42px]" />
          <div className="relative">
            <BrandLogo className="h-11 w-[164px]" />
            <div className="mt-24 max-w-xl">
              <p className="mb-5 text-xs font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">Move with confidence</p>
              <h2 className="text-5xl font-semibold leading-[1.04] tracking-[-0.055em] xl:text-6xl">Every shipment.<br /><span className="text-[#7dd3fc]">One clear view.</span></h2>
              <p className="mt-7 max-w-md text-[15px] leading-7 text-white/65">Coordinate bookings, track movement, and keep every customer promise visible from pickup to delivery.</p>
            </div>
          </div>
        </section>
        <section className="flex min-w-0 flex-col justify-center px-5 py-8 sm:px-10 lg:px-12 xl:px-20">
          <div className="mx-auto w-full max-w-[430px]">
            <div className="mb-8 flex items-center justify-between lg:hidden"><BrandLogo className="h-9 w-[142px]" /><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#738198]">Secure portal</span></div>
            <div className="mb-8"><div className="mb-5 hidden size-11 place-items-center rounded-2xl bg-[#eaf2ff] text-[#2563eb] lg:grid"><LockKeyhole className="size-5" /></div><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#2563eb]">{eyebrow}</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-[#172033] sm:text-[34px]">{title}</h1><p className="mt-3 max-w-sm text-sm leading-6 text-[#738198]">{description}</p></div>
            {children}
            <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-[11px] text-[#9aa6b8]"><ShieldCheck className="size-3.5" /> Your connection is encrypted and monitored <ArrowUpRight className="size-3" /></p>
          </div>
        </section>
      </div>
    </main>
  );
}
