import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  fetchGames,
  fetchHealth,
  fetchUserSession,
  startSession,
  stopSession,
  wakeVm,
} from './lib/api';
import type { CloudSession, Game, HealthStatus } from './types';
import { TopNav } from './components/TopNav';
import { GameLibrary } from './components/GameLibrary';
import { BOOT_STEPS, SessionBootModal, VM_WAKE_BOOT_STEPS } from './components/SessionBootModal';
import { StreamView } from './components/StreamView';

const NICKNAME_STORAGE_KEY = 'fazcloud:nickname';
const HEALTH_POLL_INTERVAL_MS = 10_000;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getInitialNickname(): string {
  try {
    const saved = window.localStorage.getItem(NICKNAME_STORAGE_KEY);
    if (saved && saved.trim()) return saved;
  } catch {
    // Ignore storage access errors
  }
  return 'player-1';
}

export function App() {
  const [nickname, setNickname] = useState<string>(getInitialNickname);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [loadingGames, setLoadingGames] = useState<boolean>(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  // Active running session detected for this user (when in library) vs currently streaming
  const [existingSession, setExistingSession] = useState<CloudSession | null>(null);
  const [activeStream, setActiveStream] = useState<CloudSession | null>(null);

  // Boot modal choreography state
  const [bootState, setBootState] = useState<{
    open: boolean;
    title: string;
    step: number;
    steps: readonly string[];
    error: string | null;
  }>({
    open: false,
    title: '',
    step: 0,
    steps: BOOT_STEPS,
    error: null,
  });

  const refreshHealth = useCallback(async () => {
    try {
      const result = await fetchHealth();
      setHealth(result.health);
      setLatencyMs(result.latencyMs);
    } catch {
      // Keep previous health state if transient failure occurs
    }
  }, []);

  const refreshUserSession = useCallback(async (userId: string) => {
    if (userId.trim().length < 2) {
      setExistingSession(null);
      return;
    }
    try {
      const session = await fetchUserSession(userId);
      setExistingSession(session);
    } catch {
      setExistingSession(null);
    }
  }, []);

  // Load games + health on mount and poll health every 10s
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const [catalog] = await Promise.all([fetchGames(), refreshHealth()]);
        if (mounted) {
          setGames(catalog);
          setLibraryError(null);
        }
      } catch (err) {
        if (mounted) {
          setLibraryError(
            err instanceof Error ? err.message : 'Unable to reach cloud gaming server.'
          );
        }
      } finally {
        if (mounted) setLoadingGames(false);
      }
    }

    init();
    const interval = window.setInterval(refreshHealth, HEALTH_POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [refreshHealth]);

  // Persist nickname and check for existing session whenever nickname changes
  useEffect(() => {
    try {
      window.localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
    } catch {
      // Ignore storage access errors
    }

    const timer = window.setTimeout(() => {
      refreshUserSession(nickname);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [nickname, refreshUserSession]);

  const handleLaunch = async (gameId: string | null, title: string) => {
    const trimmedUser = nickname.trim();
    if (trimmedUser.length < 2) {
      setBootState({
        open: true,
        title,
        step: 0,
        steps: BOOT_STEPS,
        error: 'Please enter a nickname (at least 2 characters) in the top-right bar before launching.',
      });
      return;
    }

    const needsVmWake =
      health?.vmControlEnabled &&
      (health.status === 'sleeping' || health.status === 'starting');
    const activeSteps = needsVmWake ? VM_WAKE_BOOT_STEPS : BOOT_STEPS;
    const offset = needsVmWake ? 1 : 0;

    setBootState({ open: true, title, step: 0, steps: activeSteps, error: null });

    try {
      if (needsVmWake) {
        await wakeVm();
        setBootState({ open: true, title, step: 1, steps: activeSteps, error: null });
      }

      // Step 1: Allocating GPU container slot...
      const startPromise = startSession(trimmedUser, gameId);
      await sleep(550);
      const { session } = await startPromise;

      // Step 2: Mounting save volume & initializing Proton...
      setBootState({
        open: true,
        title: session.gameTitle,
        step: offset + 1,
        steps: activeSteps,
        error: null,
      });
      await sleep(600);

      // Step 3: Connecting low-latency WebRTC stream...
      setBootState({
        open: true,
        title: session.gameTitle,
        step: offset + 2,
        steps: activeSteps,
        error: null,
      });
      await sleep(550);

      setBootState({
        open: true,
        title: session.gameTitle,
        step: offset + 3,
        steps: activeSteps,
        error: null,
      });
      await sleep(220);

      setExistingSession(session);
      setActiveStream(session);
      setBootState({ open: false, title: '', step: 0, steps: BOOT_STEPS, error: null });
      refreshHealth();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unexpected error launching session.';
      setBootState({ open: true, title, step: 0, steps: activeSteps, error: message });
      refreshHealth();
    }
  };

  const handleEndSession = async () => {
    const targetUser = activeStream?.userId ?? existingSession?.userId ?? nickname.trim();
    if (targetUser) {
      try {
        await stopSession(targetUser);
      } catch {
        // Proceed back to library cleanly even if container was already stopped
      }
    }
    setActiveStream(null);
    setExistingSession(null);
    await refreshHealth();
  };

  // Full-viewport streaming view
  if (activeStream) {
    return (
      <StreamView
        session={activeStream}
        initialLatencyMs={latencyMs}
        onEndSession={handleEndSession}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#F8FAFC]">
      <TopNav
        health={health}
        latencyMs={latencyMs}
        nickname={nickname}
        onNicknameChange={setNickname}
        onLaunchDesktop={() => handleLaunch('desktop', 'Desktop / Steam Mode')}
        isBusy={bootState.open}
      />

      <GameLibrary
        games={games}
        loading={loadingGames}
        error={libraryError}
        health={health}
        existingSession={existingSession}
        onPlayGame={(game) => handleLaunch(game.id, game.title)}
        onResumeSession={(session) => setActiveStream(session)}
        onStopExistingSession={handleEndSession}
        isBusy={bootState.open}
      />

      {bootState.open && (
        <SessionBootModal
          title={bootState.title}
          currentStep={bootState.step}
          steps={bootState.steps}
          error={bootState.error}
          onDismissError={() =>
            setBootState({ open: false, title: '', step: 0, steps: BOOT_STEPS, error: null })
          }
        />
      )}
    </div>
  );
}

export default App;
