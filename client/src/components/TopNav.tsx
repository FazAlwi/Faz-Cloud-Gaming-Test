import { Monitor, Server, User } from 'lucide-react';
import type { HealthStatus } from '../types';

interface TopNavProps {
  health: HealthStatus | null;
  latencyMs: number | null;
  nickname: string;
  onNicknameChange: (value: string) => void;
  onLaunchDesktop: () => void;
  isBusy: boolean;
}

export function TopNav({
  health,
  latencyMs,
  nickname,
  onNicknameChange,
  onLaunchDesktop,
  isBusy,
}: TopNavProps) {
  const active = health?.activeSessions ?? 0;
  const maxSlots = health?.maxSlots ?? 2;
  const isFull = active >= maxSlots;
  const isVmSleeping = health?.status === 'sleeping';
  const isVmStarting = health?.status === 'starting';
  const regionLabel = health?.regionLabel ?? 'Singapore';
  const regionCode = health?.region ?? 'asia-southeast1';
  const pingDisplay = latencyMs !== null ? `~${latencyMs}ms` : '~5ms';

  return (
    <header className="sticky top-0 z-30 border-b border-[#1E293B] bg-[#0B0F17]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        {/* Left: App Title + Region / Latency Badge */}
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-[#06B6D4]" />
            <span className="text-[15px] font-semibold tracking-tight text-[#F8FAFC]">
              FazCloud
            </span>
          </div>

          <span className="hidden h-4 w-px bg-[#1E293B] sm:block" aria-hidden="true" />

          <div
            id="region-latency-badge"
            className="hidden items-center gap-1.5 font-mono text-xs text-[#94A3B8] sm:flex"
          >
            <span>{regionLabel}</span>
            <span className="text-[#475569]">•</span>
            <span>{regionCode}</span>
            <span className="text-[#475569]">•</span>
            <span className="text-[#22D3EE]">{pingDisplay}</span>
          </div>
        </div>

        {/* Right: Desktop/Steam Launch + Capacity Pill + User Profile Input */}
        <div className="flex items-center gap-2.5">
          <button
            id="desktop-mode-btn"
            type="button"
            disabled={isBusy}
            onClick={onLaunchDesktop}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#1E293B] bg-[#131926] px-3 py-1.5 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#334155] hover:bg-[#182032] hover:text-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-50"
            title="Launch raw Linux virtual desktop with Steam & Proton-GE"
          >
            <Monitor className="h-3.5 w-3.5 text-[#22D3EE]" />
            <span className="hidden md:inline">Desktop / Steam Mode</span>
            <span className="md:hidden">Desktop</span>
          </button>

          <div
            id="capacity-pill"
            className="inline-flex items-center gap-2 rounded-lg border border-[#1E293B] bg-[#131926] px-3 py-1.5 font-mono text-xs text-[#CBD5E1]"
            title={
              health
                ? `${health.gpu} • ${
                    isVmSleeping
                      ? 'GPU VM Sleeping (auto-wakes on Play)'
                      : isVmStarting
                        ? 'GPU VM Starting...'
                        : health.mockDocker
                          ? 'Mock Mode'
                          : 'Live Docker'
                  }`
                : 'Checking server capacity...'
            }
          >
            <span
              className={`h-2 w-2 rounded-full ${
                !health
                  ? 'bg-[#64748B]'
                  : isVmStarting
                    ? 'animate-pulse bg-[#22D3EE]'
                    : isVmSleeping || isFull
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
              }`}
            />
            <Server className="hidden h-3.5 w-3.5 text-[#64748B] sm:block" />
            <span>
              {isVmSleeping
                ? 'GPU Asleep (Auto-Wake)'
                : isVmStarting
                  ? 'Waking GPU VM...'
                  : `${active} / ${maxSlots} Slots Active`}
            </span>
          </div>

          <label
            htmlFor="user-nickname-input"
            className="flex items-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#131926] px-2.5 py-1.5 transition-colors focus-within:border-[#06B6D4]"
          >
            <User className="h-3.5 w-3.5 shrink-0 text-[#64748B]" />
            <input
              id="user-nickname-input"
              type="text"
              value={nickname}
              onChange={(e) => onNicknameChange(e.target.value)}
              placeholder="Nickname"
              maxLength={32}
              aria-label="User nickname for persistent cloud saves"
              className="w-24 bg-transparent text-xs font-medium text-[#F8FAFC] placeholder-[#64748B] focus:outline-none sm:w-28"
            />
          </label>
        </div>
      </div>
    </header>
  );
}
