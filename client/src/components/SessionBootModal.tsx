import { AlertCircle, Check, Loader2 } from 'lucide-react';

export const BOOT_STEPS = [
  'Allocating GPU container slot...',
  'Mounting save volume & initializing Proton...',
  'Connecting low-latency WebRTC stream...',
] as const;

export const VM_WAKE_BOOT_STEPS = [
  'Waking NVIDIA L4 VM (~30–45s)...',
  ...BOOT_STEPS,
] as const;

interface SessionBootModalProps {
  title: string;
  currentStep: number;
  steps?: readonly string[];
  error: string | null;
  onDismissError: () => void;
}

export function SessionBootModal({
  title,
  currentStep,
  steps = BOOT_STEPS,
  error,
  onDismissError,
}: SessionBootModalProps) {
  return (
    <div
      id="session-boot-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="boot-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0F17]/92 p-6 backdrop-blur-md"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#1E293B] bg-[#131926] p-7 shadow-2xl">
        {error ? (
          <div>
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-red-900/60 bg-red-950/40 text-red-400">
              <AlertCircle className="h-5 w-5" />
            </div>
            <h2 id="boot-modal-title" className="text-lg font-semibold text-[#F8FAFC]">
              Unable to Launch Session
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#94A3B8]">{error}</p>
            <button
              id="boot-error-dismiss-btn"
              type="button"
              onClick={onDismissError}
              className="mt-6 w-full cursor-pointer rounded-lg border border-[#1E293B] bg-[#0B0F17] px-4 py-2.5 text-sm font-medium text-[#F8FAFC] transition-colors hover:border-[#334155] hover:bg-[#182032]"
            >
              Return to Library
            </button>
          </div>
        ) : (
          <div>
            <p className="font-mono text-[11px] font-medium tracking-wider text-[#22D3EE] uppercase">
              Launching Cloud Container
            </p>
            <h2
              id="boot-modal-title"
              className="mt-1.5 text-xl font-semibold tracking-tight text-[#F8FAFC]"
            >
              {title}
            </h2>

            <ol className="mt-7 space-y-4">
              {steps.map((label, index) => {
                const isDone = currentStep > index;
                const isActive = currentStep === index;

                return (
                  <li key={label} className="flex items-center gap-3.5">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        isDone
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                          : isActive
                            ? 'border-[#06B6D4]/50 bg-[#06B6D4]/15 text-[#22D3EE]'
                            : 'border-[#1E293B] bg-[#0B0F17] text-[#475569]'
                      }`}
                    >
                      {isDone ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : isActive ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      )}
                    </div>
                    <span
                      className={`text-sm transition-colors ${
                        isDone
                          ? 'text-[#CBD5E1]'
                          : isActive
                            ? 'font-medium text-[#F8FAFC]'
                            : 'text-[#64748B]'
                      }`}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
