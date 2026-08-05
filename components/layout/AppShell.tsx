"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu, ScanLine, Search, Sparkles, TrendingUp, User, Wallet, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";
import { AuroraBackdrop } from "@/components/layout/AuroraBackdrop";

const NAV_ITEMS = [
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/tokens", label: "Top Memecoins", icon: TrendingUp },
  { href: "/wallet", label: "Wallet Passport", icon: Wallet },
  { href: "/constellation", label: "Constellation", icon: Sparkles },
  { href: "/notifications", label: "Notifications", icon: Bell, soon: true },
  { href: "/profile/me", label: "Profile", icon: User },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition",
              active
                ? "bg-white/[0.06] text-ink"
                : "text-ink-muted hover:bg-white/[0.04] hover:text-ink",
            )}
          >
            <span className="flex items-center gap-3">
              <Icon
                className={cn(
                  "h-[18px] w-[18px]",
                  active ? "text-lime-soft" : "text-ink-faint group-hover:text-ink-muted",
                )}
              />
              {item.label}
            </span>
            {item.soon && (
              <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-ink-faint">
                Soon
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

  return (
    <div className="relative min-h-screen">
      <AuroraBackdrop />

      <div className="relative z-10 flex min-h-screen w-full">
        {/* Nav rail (desktop) */}
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col justify-between border-r border-line px-4 py-6 md:flex">
          <div>
            <Link href="/scan" className="mb-8 flex items-center gap-2 px-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hoodmap-logo.png"
                alt="HoodMap"
                className="h-8 w-8 rounded-lg shadow-[var(--shadow-glow-lime)]"
              />
              <div className="leading-tight">
                <div className="text-lg font-semibold tracking-tight text-ink">HoodMap</div>
                <div className="text-[9px] font-medium uppercase tracking-wider text-ink-faint">
                  Intelligence layer of robinhood chain
                </div>
              </div>
            </Link>

            <NavLinks pathname={pathname} />
          </div>

          <div className="px-2 text-[11px] leading-relaxed text-ink-faint">
            Signal &gt; noise.
            <br />
            HoodMap · Robinhood Chain wallet intelligence
          </div>
        </aside>

        {/* Nav drawer (mobile) */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="glass-panel absolute inset-y-0 left-0 flex w-[80vw] max-w-[300px] animate-fade-up flex-col justify-between rounded-none border-r border-line px-4 py-6">
              <div>
                <div className="mb-8 flex items-center justify-between px-2">
                  <Link
                    href="/scan"
                    onClick={() => setMobileNavOpen(false)}
                    className="flex items-center gap-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/hoodmap-logo.png"
                      alt="HoodMap"
                      className="h-8 w-8 rounded-lg shadow-[var(--shadow-glow-lime)]"
                    />
                    <div className="leading-tight">
                      <div className="text-lg font-semibold tracking-tight text-ink">HoodMap</div>
                      <div className="text-[9px] font-medium uppercase tracking-wider text-ink-faint">
                        Intelligence layer of robinhood chain
                      </div>
                    </div>
                  </Link>
                  <button
                    onClick={() => setMobileNavOpen(false)}
                    aria-label="Close menu"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition hover:bg-white/[0.06] hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <NavLinks pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
              </div>

              <div className="px-2 text-[11px] leading-relaxed text-ink-faint">
                Signal &gt; noise.
                <br />
                HoodMap · Robinhood Chain wallet intelligence
              </div>
            </aside>
          </div>
        )}

        {/* Main column */}
        <div className="min-h-screen min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-canvas/70 px-4 py-3 backdrop-blur-xl md:px-6">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition hover:bg-white/[0.06] hover:text-ink md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="relative hidden max-w-sm flex-1 md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                placeholder="Search people, channels, signals"
                className="h-10 w-full rounded-full border border-line bg-white/[0.03] pl-9 pr-4 text-sm text-ink placeholder:text-ink-faint outline-none transition focus:border-lime/40"
              />
            </div>
            <div className="flex flex-1 items-center gap-2 md:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hoodmap-logo.png" alt="HoodMap" className="h-8 w-8 rounded-lg" />
              <span className="font-semibold text-ink">HoodMap</span>
            </div>
            <ConnectWallet />
          </header>

          <main className="min-h-[calc(100vh-57px)]">{children}</main>
        </div>
      </div>
    </div>
  );
}
