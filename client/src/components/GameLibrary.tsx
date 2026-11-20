import { Play, Square } from 'lucide-react';
import type { CloudSession, Game, HealthStatus } from '../types';
import { GameCard } from './GameCard';

interface GameLibraryProps {
  games: Game[];
  loading: boolean;
  error: string | null;
  health: HealthStatus | null;
  existingSession: CloudSession | null;
  onPlayGame: (game: Game) => void;
  onResumeSession: (session: CloudSession) => void;
  onStopExistingSession: () => void;
  isBusy: boolean;
}

export function GameLibrary({
  games,
  loading,
  error,
  health,
  existingSession,
  onPlayGame,
  onResumeSession,
  onStopExistingSession,
  isBusy,
}: GameLibraryProps) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Header Row */}
      <div className="mb-8 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#F8FAFC]">Library</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Select a title to spin up a dedicated container with persistent cloud saves.
          </p>
        </div>

        {health && (
          <div className="font-mono text-xs text-[#64748B]">
            {health.gpu} · {health.mockDocker ? 'Dev Mock Mode' : 'Selkies-GStreamer + Proton-GE'}
          </div>
        )}
      </div>

      {/* Existing Active Session Bar (if user has a running container) */}
      {existingSession && (
        <div
          id="active-session-bar"
          className="mb-7 flex flex-col justify-between gap-3 rounded-xl border border-[#1E293B] bg-[#131926] px-4 py-3 sm:flex-row sm:items-center"
        >
          <div className="flex items-center gap-3 text-sm">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
            <span className="text-[#CBD5E1]">
              Active session:{' '}
              <strong className="font-semibold text-[#F8FAFC]">{existingSession.gameTitle}</strong>
            </span>
            <span className="hidden font-mono text-xs text-[#64748B] sm:inline">
              Port :{existingSession.port} · UDP {existingSession.webrtcUdpRange}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="resume-session-btn"
              type="button"
              disabled={isBusy}
              onClick={() => onResumeSession(existingSession)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#06B6D4] px-3.5 py-1.5 text-xs font-semibold text-[#0B0F17] transition-colors hover:bg-[#22D3EE] disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Resume
            </button>
            <button
              id="stop-existing-session-btn"
              type="button"
              disabled={isBusy}
              onClick={onStopExistingSession}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#1E293B] bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#334155] hover:text-[#F8FAFC] disabled:opacity-50"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mb-6 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Responsive 3-Column Game Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="overflow-hidden rounded-xl border border-[#1E293B] bg-[#131926]"
            >
              <div className="aspect-video w-full animate-pulse bg-[#182032]" />
              <div className="flex items-center justify-between px-4 py-4">
                <div className="space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-[#1E293B]" />
                  <div className="h-3 w-20 animate-pulse rounded bg-[#182032]" />
                </div>
                <div className="h-6 w-16 animate-pulse rounded bg-[#182032]" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <section
          aria-label="Playable PC games"
          className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
        >
          {games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              isActiveSessionGame={existingSession?.gameId === game.id}
              onPlay={onPlayGame}
              disabled={isBusy}
            />
          ))}
        </section>
      )}
    </main>
  );
}
