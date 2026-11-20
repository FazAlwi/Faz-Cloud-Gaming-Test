import { Play } from 'lucide-react';
import type { Game } from '../types';

interface GameCardProps {
  game: Game;
  isActiveSessionGame: boolean;
  onPlay: (game: Game) => void;
  disabled: boolean;
}

export function GameCard({ game, isActiveSessionGame, onPlay, disabled }: GameCardProps) {
  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-xl border border-[#1E293B] bg-[#131926] transition-colors duration-200 hover:border-[#334155]"
    >
      {/* 16:9 Cover Media + Hover Play Now CTA */}
      <div className="relative aspect-video w-full overflow-hidden bg-[#0B0F17]">
        {game.coverUrl && (
          <img
            src={game.coverUrl}
            alt={game.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />
        )}

        {/* Clean Hover Overlay revealing single Play Now button */}
        <div className="absolute inset-0 flex items-center justify-center bg-[#0B0F17]/65 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            id={`play-btn-${game.id}`}
            type="button"
            disabled={disabled}
            onClick={() => onPlay(game)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#06B6D4] px-5 py-2.5 text-sm font-semibold text-[#0B0F17] shadow-lg transition-colors hover:bg-[#22D3EE] focus:outline-none focus:ring-2 focus:ring-[#22D3EE] focus:ring-offset-2 focus:ring-offset-[#0B0F17] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4 fill-current" />
            <span>{isActiveSessionGame ? 'Resume Stream' : 'Play Now'}</span>
          </button>
        </div>

        {isActiveSessionGame && (
          <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-md border border-[#1E293B] bg-[#0B0F17]/85 px-2 py-1 font-mono text-[11px] font-medium text-emerald-400 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Running
          </div>
        )}
      </div>

      {/* Minimal Metadata Footer */}
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-[#F8FAFC]">
            {game.title}
          </h2>
          <p className="mt-0.5 text-xs text-[#94A3B8]">{game.genre}</p>
        </div>

        <span className="shrink-0 rounded-md border border-[#1E293B] bg-[#0B0F17] px-2 py-1 font-mono text-[11px] text-[#94A3B8]">
          {game.vramGb} GB VRAM
        </span>
      </div>
    </article>
  );
}
