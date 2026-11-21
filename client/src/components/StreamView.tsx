import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Maximize2, Minimize2, Power } from 'lucide-react';
import { sendHeartbeat } from '../lib/api';
import type { CloudSession } from '../types';

interface StreamViewProps {
  session: CloudSession;
  initialLatencyMs: number | null;
  onEndSession: () => Promise<void>;
}

const HUD_HIDE_DELAY_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export function StreamView({ session, initialLatencyMs, onEndSession }: StreamViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const isHoveringHudRef = useRef(false);

  const [hudVisible, setHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [pingMs, setPingMs] = useState<number>(initialLatencyMs ?? 5);
  const [fps, setFps] = useState<number>(60);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      if (!isHoveringHudRef.current) {
        setHudVisible(false);
      }
    }, HUD_HIDE_DELAY_MS);
  }, []);

  const revealHud = useCallback(() => {
    setHudVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  // Initial auto-hide timer on stream mount
  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [scheduleHide]);

  // Periodic heartbeat every 30s to prevent 10-minute idle container reaper
  useEffect(() => {
    const tick = () => {
      sendHeartbeat(session.userId).catch(() => {
        // Non-fatal; next heartbeat will retry
      });
    };

    const interval = window.setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [session.userId]);

  // Stop session container and auto-stop VM if the user closes or reloads the tab
  useEffect(() => {
    const onBeforeUnload = () => {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const payload = JSON.stringify({ userId: session.userId });
        navigator.sendBeacon(
          '/api/sessions/stop',
          new Blob([payload], { type: 'application/json' })
        );
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [session.userId]);

  // Listen for optional live telemetry postMessages from stream viewport
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'STREAM_TELEMETRY') {
        if (typeof event.data.pingMs === 'number') setPingMs(event.data.pingMs);
        if (typeof event.data.fps === 'number') setFps(event.data.fps);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Track browser fullscreen changes
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await (containerRef.current ?? document.documentElement).requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore if fullscreen is blocked by browser policy
    }
  };

  const handleEndClick = async () => {
    if (isEnding) return;
    setIsEnding(true);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      await onEndSession();
    } finally {
      setIsEnding(false);
    }
  };

  const resolvedStreamUrl =
    session.mock &&
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
      ? `/mock-stream/${session.sessionId}`
      : session.streamUrl;

  return (
    <div
      ref={containerRef}
      id="stream-viewport"
      className="fixed inset-0 h-screen w-screen overflow-hidden bg-black"
    >
      {/* Full-viewport borderless Selkies WebRTC stream iframe */}
      <iframe
        id="selkies-stream-iframe"
        src={resolvedStreamUrl}
        title={`${session.gameTitle} Cloud Stream`}
        allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write; pointer-lock"
        allowFullScreen
        className="h-full w-full border-0"
      />

      {/* Top-edge hover trigger strip (ensures reveal works even over iframe) */}
      <div
        id="hud-hover-trigger"
        onMouseEnter={revealHud}
        className="fixed top-0 left-1/2 z-40 flex h-4 w-48 -translate-x-1/2 items-start justify-center pt-1"
      >
        {!hudVisible && (
          <span
            className="h-1 w-12 rounded-full bg-slate-400/35 transition-opacity hover:bg-[#22D3EE]/70"
            aria-hidden="true"
          />
        )}
      </div>

      {/* Tiny, unobtrusive auto-hiding top-center floating pill */}
      <div
        id="stream-floating-pill"
        onMouseEnter={() => {
          isHoveringHudRef.current = true;
          if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
          setHudVisible(true);
        }}
        onMouseLeave={() => {
          isHoveringHudRef.current = false;
          scheduleHide();
        }}
        className={`fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#1E293B] bg-[#0B0F17]/90 px-3 py-1.5 shadow-2xl backdrop-blur-md transition-all duration-200 ${
          hudVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-4 opacity-0'
        }`}
      >
        {/* Live status dot + ping/FPS readout */}
        <div className="flex items-center gap-2 pl-1 pr-1.5 font-mono text-xs text-[#CBD5E1]">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>{pingMs}ms</span>
          <span className="text-[#475569]">·</span>
          <span>{fps} FPS</span>
        </div>

        <span className="hidden h-3.5 w-px bg-[#1E293B] sm:block" aria-hidden="true" />

        {/* Gaming Mode / Pointer Lock shortcut hint */}
        <div
          className="hidden items-center gap-1.5 px-1 text-[11px] text-[#94A3B8] sm:flex"
          title="Press Ctrl+Shift+G (or click the Crosshair icon in the left Selkies sidebar) to lock mouse for 3D camera control. Hold Esc to unlock."
        >
          <span className="text-[#22D3EE] font-medium">3D Mouse Lock:</span>
          <kbd className="rounded bg-[#1E293B] px-1.5 py-0.5 font-mono text-[10px] text-[#F8FAFC]">
            Ctrl+Shift+G
          </kbd>
        </div>

        <span className="h-3.5 w-px bg-[#1E293B]" aria-hidden="true" />

        {/* Fullscreen toggle */}
        <button
          id="stream-fullscreen-btn"
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          className="inline-flex cursor-pointer items-center justify-center rounded-full p-1.5 text-[#CBD5E1] transition-colors hover:bg-[#1E293B] hover:text-[#F8FAFC]"
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Open Stream in Tab (helps when browser requires accepting self-signed certificate) */}
        <a
          id="stream-open-tab-btn"
          href={resolvedStreamUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open stream in a new tab (useful if your browser blocks self-signed HTTPS iframes)"
          className="inline-flex cursor-pointer items-center justify-center rounded-full p-1.5 text-[#CBD5E1] transition-colors hover:bg-[#1E293B] hover:text-[#F8FAFC]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>

        {/* End Session button */}
        <button
          id="stream-end-session-btn"
          type="button"
          disabled={isEnding}
          onClick={handleEndClick}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/25 hover:text-red-200 disabled:opacity-50"
        >
          {isEnding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Power className="h-3.5 w-3.5" />
          )}
          <span>{isEnding ? 'Stopping...' : 'End Session'}</span>
        </button>
      </div>
    </div>
  );
}
