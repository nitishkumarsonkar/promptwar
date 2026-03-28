"use client";

/**
 * @file page.tsx
 * @description Universal Intent Bridge — main application page.
 *
 * Renders the full client-side UI for the 5-agent AI decision engine:
 *   - Text / image / sensor input panel
 *   - Real-time agent pipeline status display
 *   - Structured results: urgency banner, HITL action, steps, simulation, explanation
 *   - Session memory (backed by localStorage, capped at 8 entries)
 *
 * All API calls go to POST /api/bridge (server-side only — no API key in client).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, AlertCircle, Send, Activity, Cpu,
  ShieldAlert, ShieldCheck, ShieldX,
  Ambulance, HeartPulse, Building2, Car,
  ChevronDown, ChevronRight, Clock, Zap,
  CheckCircle2, XCircle, Info, Flame,
  TriangleAlert, BrainCircuit, ListChecks,
  Eye, History, MapPin, Trash2,
} from 'lucide-react';

// ─── Domain types (mirrored from API — kept in sync with agents.ts) ───────────

/** A single auto-action emitted by the Verification agent. */
interface SimulationAction {
  action: string;
  status: 'simulated' | 'ready_for_api' | 'requires_user';
}

/** Raw output from the Emergency domain agent. */
interface EmergencyAgentOutput {
  emergency_detected: boolean;
  emergency_type: string;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  dispatch_required: boolean;
  sos_actions: string[];
  raw_reasoning: string;
}

/** Raw output from the Medical domain agent. */
interface MedicalAgentOutput {
  medical_situation_detected: boolean;
  conditions: string[];
  medications_mentioned: string[];
  treatment_steps: string[];
  hospital_required: boolean;
  raw_reasoning: string;
}

/** Raw output from the Civic domain agent. */
interface CivicAgentOutput {
  civic_issue_detected: boolean;
  issue_type: string;
  responsible_authority: string;
  report_detail: string;
  resolution_eta: string;
  raw_reasoning: string;
}

/** Raw output from the Mobility domain agent. */
interface MobilityAgentOutput {
  mobility_issue_detected: boolean;
  route_change_required: boolean;
  affected_area: string;
  estimated_delay: string;
  alternative_routes: string[];
  raw_reasoning: string;
}

/** Unified response returned by POST /api/bridge. */
interface MultiAgentResponse {
  intent: string;
  urgency_level: 'low' | 'medium' | 'high' | 'critical';
  agents: {
    emergency: EmergencyAgentOutput;
    medical: MedicalAgentOutput;
    civic: CivicAgentOutput;
    mobility: MobilityAgentOutput;
  };
  next_best_action: string;
  next_3_steps: string[];
  recommended_actions: string[];
  confidence_score: number;
  risk_flags: string[];
  status: 'verified' | 'needs_confirmation' | 'critical_uncertain';
  simulation: SimulationAction[];
  explanation: {
    why_this_action: string;
    risk_if_ignored: string;
    estimated_time_to_resolution: string;
  };
  human_readable_summary: string;
}

/** A single entry stored in the session memory panel. */
interface SessionMemoryEntry {
  id: string;
  timestamp: string;
  /** Truncated user input for display. */
  inputPreview: string;
  urgency: MultiAgentResponse['urgency_level'];
  /** Truncated intent string for display. */
  intentPreview: string;
}

// ─── Agent pipeline phase ─────────────────────────────────────────────────────

/** Tracks which visual phase the loading panel should display. */
type AgentPipelinePhase = 'idle' | 'domain' | 'verify' | 'done';

/** Tracks the human-in-the-loop confirmation state. */
type HitlChoice = 'confirm' | 'deny' | null;

// ─── UI configuration constants ───────────────────────────────────────────────

/**
 * Display metadata for each of the 5 agents shown in the loading panel
 * and idle-state chip list.
 */
const AGENT_DISPLAY_CONFIG = [
  { key: 'emergency', label: 'Emergency', icon: Ambulance,   color: 'text-red-400',     bg: 'bg-red-500/10',    border: 'border-red-500/20' },
  { key: 'medical',   label: 'Medical',   icon: HeartPulse,  color: 'text-pink-400',    bg: 'bg-pink-500/10',   border: 'border-pink-500/20' },
  { key: 'civic',     label: 'Civic',     icon: Building2,   color: 'text-amber-400',   bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
  { key: 'mobility',  label: 'Mobility',  icon: Car,         color: 'text-cyan-400',    bg: 'bg-cyan-500/10',   border: 'border-cyan-500/20' },
  { key: 'verify',    label: 'Verify',    icon: ShieldCheck, color: 'text-indigo-400',  bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' },
] as const;

/** Maps urgency level → Tailwind classes for borders, backgrounds, and badges. */
const URGENCY_STYLES: Record<
  MultiAgentResponse['urgency_level'],
  { border: string; bg: string; badge: string; glow: string; text: string }
> = {
  critical: { border: 'border-red-500',    bg: 'bg-red-500/15',    badge: 'bg-red-500 text-white',       glow: 'animate-glow-red', text: 'text-red-400' },
  high:     { border: 'border-orange-500', bg: 'bg-orange-500/10', badge: 'bg-orange-500 text-white',    glow: '',                 text: 'text-orange-400' },
  medium:   { border: 'border-amber-400',  bg: 'bg-amber-500/10',  badge: 'bg-amber-400 text-slate-900', glow: '',                 text: 'text-amber-400' },
  low:      { border: 'border-emerald-500',bg: 'bg-emerald-500/10',badge: 'bg-emerald-500 text-white',   glow: '',                 text: 'text-emerald-400' },
};

/** Maps verification status → display icon, colour, and label. */
const STATUS_STYLES: Record<
  MultiAgentResponse['status'],
  { icon: typeof ShieldCheck; color: string; bg: string; border: string; label: string }
> = {
  verified:            { icon: ShieldCheck, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Verified' },
  needs_confirmation:  { icon: ShieldAlert, color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   label: 'Needs Confirmation' },
  critical_uncertain:  { icon: ShieldX,     color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     label: 'Critical — Uncertain' },
};

/** Maps simulation action status → colour, badge label, and dot style. */
const SIMULATION_STATUS_STYLES: Record<
  SimulationAction['status'],
  { color: string; bg: string; border: string; dot: string; label: string }
> = {
  simulated:      { color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    dot: 'bg-blue-400',    label: 'Simulated' },
  ready_for_api:  { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-400', label: 'Ready' },
  requires_user:  { color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   dot: 'bg-amber-400',   label: 'User Required' },
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** localStorage key for persisting session memory between page reloads. */
const SESSION_MEMORY_STORAGE_KEY = 'bridge_memory';

/** Maximum number of session memory entries retained. */
const MAX_MEMORY_ENTRIES = 8;

/** Approximate delay (ms) before the loading UI transitions to the "verify" phase. */
const VERIFY_PHASE_DELAY_MS = 3200;

// ─── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Formats an ISO timestamp to a locale-aware HH:MM string.
 * @param isoTimestamp - ISO 8601 datetime string.
 */
function formatTimeFromIso(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Truncates a string to `maxLength` characters, appending "…" if truncated.
 * @param text      - The string to truncate.
 * @param maxLength - Maximum number of characters to retain.
 */
function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Animated status pill displayed in the agent pipeline loading panel.
 * Shows a spinner during `loading`, a check icon when `done`, or the
 * agent icon (dimmed) when `idle`.
 */
function AgentStatusPill({
  label,
  icon: Icon,
  color,
  bg,
  border,
  phase,
}: {
  label: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  color: string;
  bg: string;
  border: string;
  phase: 'idle' | 'loading' | 'done';
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-500 ${bg} ${border}`}>
      {phase === 'loading' ? (
        <div className={`w-3.5 h-3.5 rounded-full border-2 border-t-transparent ${color.replace('text-', 'border-')} animate-agent-spin`} />
      ) : phase === 'done' ? (
        <CheckCircle2 className={`w-3.5 h-3.5 ${color}`} />
      ) : (
        <Icon className={`w-3.5 h-3.5 ${color} opacity-40`} />
      )}
      <span className={`text-xs font-medium ${phase === 'idle' ? 'text-slate-500' : color}`}>
        {label}
      </span>
    </div>
  );
}

/**
 * Expandable card that shows detailed output for a single domain agent.
 * Collapses by default; the header row acts as a toggle button.
 */
function AgentDetailCard({
  label,
  icon: Icon,
  color,
  bg,
  border,
  isActive,
  children,
}: {
  label: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  color: string;
  bg: string;
  border: string;
  isActive: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`rounded-xl border transition-all duration-300 ${isActive ? `${bg} ${border}` : 'bg-slate-900/50 border-slate-800'}`}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-4 py-3 group"
      >
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${isActive ? bg : 'bg-slate-800'} ${isActive ? border : 'border-slate-700'} border`}>
            <Icon className={`w-4 h-4 ${isActive ? color : 'text-slate-500'}`} />
          </div>
          <span className={`text-sm font-semibold ${isActive ? color : 'text-slate-500'}`}>
            {label}
          </span>
          {isActive && (
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${bg} ${color} border ${border}`}>
              Active
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500" />
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-4 animate-fade-in">
          <div className="border-t border-slate-800 pt-3 space-y-2">{children}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Animated horizontal confidence gauge.
 * Colour changes: green ≥ 80%, amber ≥ 50%, red < 50%.
 */
function ConfidenceGauge({ value }: { value: number }) {
  const percentage = Math.round(value * 100);
  const barColor =
    percentage >= 80 ? 'bg-emerald-500' : percentage >= 50 ? 'bg-amber-400' : 'bg-red-500';

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-end">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
          Confidence
        </span>
        <span className="text-2xl font-bold gradient-text-blue animate-count-up">
          {percentage}%
        </span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full gauge-fill ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Single-row key-value display used inside AgentDetailCard.
 * The key column has a fixed width for alignment.
 */
function KeyValueRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-slate-500 shrink-0 w-32">{label}</span>
      <span className="text-slate-300">{value}</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

/**
 * Universal Intent Bridge home page.
 *
 * State overview:
 *   - `textInput`           — user's free-form text
 *   - `sensorContext`       — optional GPS/weather metadata string
 *   - `imageDataUrl`        — Base64 image from file input
 *   - `isLoading`           — global request-in-flight flag
 *   - `pipelinePhase`       — drives the loading panel animation
 *   - `result`              — last successful MultiAgentResponse
 *   - `errorMessage`        — last error string (cleared on new submit)
 *   - `hitlChoice`          — human-in-the-loop confirm/deny
 *   - `isMemoryPanelOpen`   — controls session memory panel visibility
 *   - `sessionMemory`       — array of past session entries
 */
export default function Home() {
  const [textInput, setTextInput] = useState('');
  const [sensorContext, setSensorContext] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pipelinePhase, setPipelinePhase] = useState<AgentPipelinePhase>('idle');
  const [result, setResult] = useState<MultiAgentResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hitlChoice, setHitlChoice] = useState<HitlChoice>(null);
  const [isMemoryPanelOpen, setIsMemoryPanelOpen] = useState(false);
  const [sessionMemory, setSessionMemory] = useState<SessionMemoryEntry[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load session memory from localStorage on first render ──────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SESSION_MEMORY_STORAGE_KEY);
      if (stored) {
        setSessionMemory(JSON.parse(stored) as SessionMemoryEntry[]);
      }
    } catch {
      // localStorage may be unavailable (e.g. private browsing) — fail silently.
    }
  }, []);

  // ── Persist a new result to session memory ─────────────────────────────────
  const persistToSessionMemory = useCallback(
    (rawInput: string, response: MultiAgentResponse) => {
      const entry: SessionMemoryEntry = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        inputPreview: truncateText(rawInput, 80),
        urgency: response.urgency_level,
        intentPreview: truncateText(response.intent, 60),
      };

      setSessionMemory((prev) => {
        const updated = [entry, ...prev].slice(0, MAX_MEMORY_ENTRIES);
        try {
          localStorage.setItem(SESSION_MEMORY_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // Storage quota exceeded — update state but don't crash.
        }
        return updated;
      });
    },
    []
  );

  // ── Handle image file selection ────────────────────────────────────────────
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  // ── Submit to the API bridge ───────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!textInput && !imageDataUrl) return;

    setIsLoading(true);
    setErrorMessage(null);
    setResult(null);
    setHitlChoice(null);
    setPipelinePhase('domain');

    // After ~3 seconds, transition the loading panel to the "verify" phase.
    const verifyPhaseTimer = setTimeout(
      () => setPipelinePhase('verify'),
      VERIFY_PHASE_DELAY_MS
    );

    try {
      const response = await fetch('/api/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textInput,
          image: imageDataUrl,
          mockContext: sensorContext,
        }),
      });

      const data = (await response.json()) as MultiAgentResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to process request.');
      }

      setPipelinePhase('done');
      setResult(data);
      persistToSessionMemory(textInput || '(image input)', data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setErrorMessage(message);
      setPipelinePhase('idle');
    } finally {
      clearTimeout(verifyPhaseTimer);
      setIsLoading(false);
    }
  };

  // ── Derived display config ─────────────────────────────────────────────────
  const urgencyStyles = result ? (URGENCY_STYLES[result.urgency_level] ?? URGENCY_STYLES.low) : null;
  const statusStyles  = result ? (STATUS_STYLES[result.status] ?? STATUS_STYLES.verified) : null;
  const StatusIcon    = statusStyles?.icon ?? ShieldCheck;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#020818] text-slate-200 selection:bg-blue-500/30">

      {/* Subtle grid backdrop */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(#334155 1px,transparent 1px),linear-gradient(90deg,#334155 1px,transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Critical urgency red glow overlay */}
      {result?.urgency_level === 'critical' && (
        <div className="fixed inset-0 pointer-events-none z-0 bg-red-900/10 animate-glow-red" />
      )}

      <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-8">

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="relative p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 animate-glow-blue">
              <Cpu className="text-blue-400 w-7 h-7" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-400 rounded-full animate-blink" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold gradient-text-blue">
                Universal Intent Bridge
              </h1>
              <p className="text-slate-500 text-sm mt-0.5">
                5-Agent AI Decision Engine · Gemini Powered
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Session memory toggle */}
            <button
              id="memory-toggle-btn"
              onClick={() => setIsMemoryPanelOpen((prev) => !prev)}
              aria-expanded={isMemoryPanelOpen}
              aria-label="Toggle session memory panel"
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition-all text-sm"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Session Memory</span>
              {sessionMemory.length > 0 && (
                <span className="bg-blue-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {sessionMemory.length}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* ── SESSION MEMORY PANEL ─────────────────────────────────────────── */}
        {isMemoryPanelOpen && (
          <div className="glass rounded-2xl p-4 animate-slide-up space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-400" /> Session Memory
              </h2>
              {sessionMemory.length > 0 && (
                <button
                  id="clear-memory-btn"
                  onClick={() => {
                    setSessionMemory([]);
                    localStorage.removeItem(SESSION_MEMORY_STORAGE_KEY);
                  }}
                  aria-label="Clear session memory"
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              )}
            </div>

            {sessionMemory.length === 0 ? (
              <p className="text-sm text-slate-600 italic">No past sessions yet.</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {sessionMemory.map((entry, index) => (
                  <button
                    key={entry.id}
                    onClick={() => {
                      setTextInput(entry.inputPreview);
                      setIsMemoryPanelOpen(false);
                    }}
                    aria-label={`Restore session: ${entry.inputPreview}`}
                    className={`text-left p-3 rounded-xl border bg-slate-900/50 border-slate-800 hover:border-slate-600 transition-all animate-slide-up stagger-${Math.min(index + 1, 5)}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${URGENCY_STYLES[entry.urgency]?.badge ?? 'bg-slate-700 text-slate-300'}`}
                      >
                        {entry.urgency}
                      </span>
                      <span className="text-[10px] text-slate-600 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatTimeFromIso(entry.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{entry.inputPreview}</p>
                    <p className="text-[10px] text-slate-600 mt-0.5 italic">{entry.intentPreview}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── MAIN GRID ────────────────────────────────────────────────────── */}
        <main className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ── LEFT: Input Panel ───────────────────────────────────────────── */}
          <section className="lg:col-span-2 glass rounded-2xl p-6 space-y-5">

            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-blink" />
              Input Signal
            </h2>

            {/* Text input */}
            <div>
              <label htmlFor="text-input" className="block text-xs font-medium text-slate-500 mb-1.5">
                Unstructured Input
              </label>
              <textarea
                id="text-input"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="e.g., 'my dad fell down, not responding, we are near Whitefield Road'"
                className="w-full h-28 bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none transition-all"
              />
            </div>

            {/* Image upload */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Visual Context (Optional)
              </label>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                aria-label="Upload an image for visual context"
                className="border-2 border-dashed border-slate-800 hover:border-blue-500/40 hover:bg-slate-800/30 rounded-xl p-5 flex flex-col items-center justify-center cursor-pointer transition-all group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  id="image-upload-input"
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageUpload}
                />
                {imageDataUrl ? (
                  // alt text intentionally generic — image content is unknown at render time
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageDataUrl}
                    alt="Uploaded image preview"
                    className="max-h-36 rounded-lg object-contain shadow-md"
                  />
                ) : (
                  <div className="text-center group-hover:scale-105 transition-transform duration-300">
                    <div className="bg-slate-800 p-3 rounded-full inline-block mb-2 border border-slate-700 text-slate-500 group-hover:text-blue-400 group-hover:border-blue-500/30 transition-colors">
                      <Upload className="w-5 h-5" />
                    </div>
                    <p className="text-xs text-slate-500">
                      Accident scene, prescription, or document
                    </p>
                  </div>
                )}
              </div>
              {imageDataUrl && (
                <button
                  onClick={() => setImageDataUrl(null)}
                  aria-label="Remove uploaded image"
                  className="text-xs text-red-400 mt-1.5 hover:underline flex items-center gap-1"
                >
                  <XCircle className="w-3 h-3" /> Remove Image
                </button>
              )}
            </div>

            {/* Sensor / context data */}
            <div>
              <label htmlFor="sensor-context-input" className="block text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3 h-3" /> Sensor / Context Data
              </label>
              <input
                id="sensor-context-input"
                type="text"
                value={sensorContext}
                onChange={(e) => setSensorContext(e.target.value)}
                placeholder="e.g., Location: 12.97°N, 77.74°E | Weather: Heavy Rain"
                className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
              />
            </div>

            {/* Submit */}
            <button
              id="submit-btn"
              onClick={handleSubmit}
              disabled={isLoading || (!textInput && !imageDataUrl)}
              aria-label="Submit input to the multi-agent pipeline"
              className="w-full relative overflow-hidden bg-blue-600 hover:bg-blue-500 text-white font-semibold p-3.5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_24px_rgba(59,130,246,0.2)] hover:shadow-[0_0_32px_rgba(59,130,246,0.4)] group"
            >
              {isLoading ? (
                <Activity className="w-5 h-5 animate-agent-spin" />
              ) : (
                <Send className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
              )}
              {isLoading ? 'Orchestrating Agents…' : 'Bridge Knowledge to Action'}
            </button>

            {/* Error display */}
            {errorMessage && (
              <div
                role="alert"
                className="p-3.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl flex items-start gap-2.5 animate-slide-up"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-sm">{errorMessage}</p>
              </div>
            )}
          </section>

          {/* ── RIGHT: Results Panel ─────────────────────────────────────── */}
          <section className="lg:col-span-3 space-y-5">

            {/* Idle state */}
            {!result && !isLoading && (
              <div className="glass rounded-2xl flex flex-col items-center justify-center p-16 text-center min-h-[480px] animate-fade-in">
                <div className="relative mb-5">
                  <BrainCircuit className="w-16 h-16 text-slate-700" />
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-slate-700 rounded-full animate-blink" />
                </div>
                <h3 className="text-lg font-semibold text-slate-400">
                  5-Agent Engine Standing By
                </h3>
                <p className="text-sm text-slate-600 max-w-xs mt-2 leading-relaxed">
                  Submit any unstructured input — text, image, or sensor data — to activate
                  the multi-agent decision engine.
                </p>
                <div className="flex flex-wrap justify-center gap-2 mt-6">
                  {AGENT_DISPLAY_CONFIG.map(({ label, icon: Icon, color, bg, border }) => (
                    <span
                      key={label}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs ${bg} ${color} border ${border}`}
                    >
                      <Icon className="w-3 h-3" />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Loading — agent phase indicator */}
            {isLoading && (
              <div
                role="status"
                aria-live="polite"
                aria-label="Agent pipeline is running"
                className="glass rounded-2xl p-6 space-y-6 min-h-[480px] animate-fade-in"
              >
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-400 animate-agent-spin" />
                  Agent Pipeline Running
                </h3>

                <div className="space-y-3">
                  {AGENT_DISPLAY_CONFIG.map(({ key, label, icon, color, bg, border }, index) => {
                    const isVerifyAgent = key === 'verify';

                    // Map global pipeline phase → per-agent pill phase
                    const pillPhase: 'idle' | 'loading' | 'done' =
                      pipelinePhase === 'idle'   ? 'idle' :
                      pipelinePhase === 'domain' ? (isVerifyAgent ? 'idle' : 'loading') :
                      pipelinePhase === 'verify' ? (isVerifyAgent ? 'loading' : 'done') :
                      'done';

                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-500 stagger-${index + 1} animate-slide-right
                          ${pillPhase === 'loading' ? `${bg} ${border}` : pillPhase === 'done' ? 'bg-slate-900/50 border-emerald-500/20' : 'bg-slate-900/30 border-slate-800'}`}
                      >
                        <AgentStatusPill
                          label={label}
                          icon={icon}
                          color={color}
                          bg={bg}
                          border={border}
                          phase={pillPhase}
                        />
                        <p className="text-xs text-slate-500 flex-1">
                          {pillPhase === 'loading'
                            ? isVerifyAgent
                              ? 'Cross-checking domain outputs…'
                              : 'Analysing input…'
                            : pillPhase === 'done'
                              ? 'Analysis complete'
                              : 'Waiting…'}
                        </p>
                        {pillPhase === 'loading' && (
                          <div className="shimmer h-2 w-24 rounded-full" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {pipelinePhase === 'verify' && (
                  <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 animate-slide-up">
                    <p className="text-sm text-indigo-300 font-medium flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 animate-agent-spin" />
                      Verification Agent (Gemini 2.5 Pro) synthesising all domain outputs…
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Results */}
            {result && !isLoading && (
              <div className="space-y-5 animate-slide-up">

                {/* ── Urgency Banner ── */}
                <div
                  className={`rounded-2xl border-2 p-5 ${urgencyStyles!.bg} ${urgencyStyles!.border} ${urgencyStyles!.glow}`}
                  role="region"
                  aria-label={`Urgency level: ${result.urgency_level}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {result.urgency_level === 'critical' && (
                          <Flame className="w-5 h-5 text-red-400 animate-blink" />
                        )}
                        {result.urgency_level === 'high' && (
                          <TriangleAlert className="w-5 h-5 text-orange-400" />
                        )}
                        <span className={`text-xs font-bold uppercase tracking-widest ${urgencyStyles!.text}`}>
                          {result.urgency_level} URGENCY
                        </span>
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${urgencyStyles!.badge}`}>
                          {result.urgency_level}
                        </span>
                      </div>
                      <h2 className="text-lg font-bold text-slate-100 capitalize">
                        {result.intent?.replace(/_/g, ' ')}
                      </h2>
                      <p className="text-sm text-slate-400 mt-1 leading-relaxed max-w-lg">
                        {result.human_readable_summary}
                      </p>
                    </div>
                    <div className="shrink-0 w-40">
                      <ConfidenceGauge value={result.confidence_score} />
                    </div>
                  </div>

                  {/* Status badge + risk flags */}
                  <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-800/50">
                    <div
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${statusStyles!.bg} ${statusStyles!.color} border ${statusStyles!.border}`}
                      aria-label={`Verification status: ${statusStyles!.label}`}
                    >
                      <StatusIcon className="w-3.5 h-3.5" /> {statusStyles!.label}
                    </div>
                    {result.risk_flags?.map((flag, index) => (
                      <span
                        key={index}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-slate-800 text-amber-400 border border-amber-500/20"
                      >
                        <Info className="w-3 h-3" /> {flag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* ── Human-in-the-Loop: Next Best Action ── */}
                <div className="glass rounded-2xl p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20 shrink-0">
                      <Zap className="w-5 h-5 text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <span className="text-xs font-bold uppercase tracking-widest text-blue-400">
                        Next Best Action
                      </span>
                      <p className="text-base font-semibold text-slate-100 mt-1">
                        {result.next_best_action}
                      </p>
                    </div>
                  </div>

                  {hitlChoice === null && (
                    <div className="flex gap-3 mt-2">
                      <button
                        id="confirm-action-btn"
                        onClick={() => setHitlChoice('confirm')}
                        aria-label="Confirm the recommended action"
                        className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all text-sm font-semibold"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Confirm
                      </button>
                      <button
                        id="deny-action-btn"
                        onClick={() => setHitlChoice('deny')}
                        aria-label="Deny the recommended action"
                        className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all text-sm font-semibold"
                      >
                        <XCircle className="w-4 h-4" /> Deny
                      </button>
                    </div>
                  )}

                  {hitlChoice === 'confirm' && (
                    <div
                      role="alert"
                      className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl animate-fade-in"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-emerald-300 font-medium">
                        Action confirmed — simulation pipeline activated.
                      </span>
                    </div>
                  )}
                  {hitlChoice === 'deny' && (
                    <div
                      role="alert"
                      className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl animate-fade-in"
                    >
                      <XCircle className="w-4 h-4 text-red-400" />
                      <span className="text-sm text-red-300 font-medium">
                        Action denied — escalating to human authority.
                      </span>
                    </div>
                  )}
                </div>

                {/* ── Steps + Simulation (two-column) ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

                  {/* Next 3 Steps */}
                  <div className="glass rounded-2xl p-5">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2 mb-4">
                      <ListChecks className="w-4 h-4 text-indigo-400" /> Next 3 Steps
                    </h3>
                    <ol className="space-y-3">
                      {result.next_3_steps?.map((step, index) => (
                        <li key={index} className={`flex gap-3 animate-slide-up stagger-${index + 1}`}>
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-xs font-bold flex items-center justify-center">
                            {index + 1}
                          </span>
                          <span className="text-sm text-slate-300 leading-relaxed">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Simulation Feed */}
                  <div className="glass rounded-2xl p-5">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2 mb-4">
                      <Activity className="w-4 h-4 text-cyan-400 animate-blink" /> Auto-Action Simulation
                    </h3>
                    <div className="space-y-2">
                      {result.simulation?.map((simAction, index) => {
                        const simStyles = SIMULATION_STATUS_STYLES[simAction.status];
                        return (
                          <div
                            key={index}
                            className={`flex items-start gap-3 p-3 rounded-xl border text-xs ${simStyles.bg} ${simStyles.border} animate-slide-right stagger-${index + 1}`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 mt-1 ${simStyles.dot} ${simAction.status === 'simulated' ? 'animate-blink' : ''}`}
                            />
                            <span className={`flex-1 ${simStyles.color} font-medium`}>
                              {simAction.action}
                            </span>
                            <span
                              className={`shrink-0 px-2 py-0.5 rounded-full font-bold text-[10px] uppercase ${simStyles.bg} ${simStyles.color} border ${simStyles.border}`}
                            >
                              {simStyles.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* ── Explanation Cards ── */}
                <div className="glass rounded-2xl p-5 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2 mb-2">
                    <Eye className="w-4 h-4 text-blue-400" /> Explanation
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      {
                        label: 'Why This Action',
                        icon: BrainCircuit,
                        color: 'text-blue-400',
                        bg: 'bg-blue-500/10',
                        border: 'border-blue-500/20',
                        value: result.explanation?.why_this_action,
                      },
                      {
                        label: 'Risk if Ignored',
                        icon: TriangleAlert,
                        color: 'text-red-400',
                        bg: 'bg-red-500/10',
                        border: 'border-red-500/20',
                        value: result.explanation?.risk_if_ignored,
                      },
                      {
                        label: 'Time to Resolution',
                        icon: Clock,
                        color: 'text-cyan-400',
                        bg: 'bg-cyan-500/10',
                        border: 'border-cyan-500/20',
                        value: result.explanation?.estimated_time_to_resolution,
                      },
                    ].map(({ label, icon: Icon, color, bg, border, value }) => (
                      <div key={label} className={`rounded-xl p-3 ${bg} border ${border}`}>
                        <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase ${color} mb-1.5`}>
                          <Icon className="w-3 h-3" />
                          {label}
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Agent Output Cards ── */}
                <div className="glass rounded-2xl p-5">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2 mb-4">
                    <BrainCircuit className="w-4 h-4 text-indigo-400" /> Agent Outputs
                  </h3>
                  <div className="space-y-2">

                    <AgentDetailCard
                      label="Emergency Agent"
                      icon={Ambulance}
                      color="text-red-400"
                      bg="bg-red-500/10"
                      border="border-red-500/20"
                      isActive={result.agents.emergency.emergency_detected}
                    >
                      <KeyValueRow label="Emergency Type" value={result.agents.emergency.emergency_type} />
                      <KeyValueRow label="Severity"       value={result.agents.emergency.severity} />
                      <KeyValueRow label="Dispatch?"      value={result.agents.emergency.dispatch_required ? 'Yes' : 'No'} />
                      <KeyValueRow label="SOS Actions"    value={result.agents.emergency.sos_actions?.join('; ')} />
                      <KeyValueRow label="Reasoning"      value={result.agents.emergency.raw_reasoning} />
                    </AgentDetailCard>

                    <AgentDetailCard
                      label="Medical Agent"
                      icon={HeartPulse}
                      color="text-pink-400"
                      bg="bg-pink-500/10"
                      border="border-pink-500/20"
                      isActive={result.agents.medical.medical_situation_detected}
                    >
                      <KeyValueRow label="Conditions"  value={result.agents.medical.conditions?.join(', ') || 'None'} />
                      <KeyValueRow label="Medications" value={result.agents.medical.medications_mentioned?.join(', ') || 'None'} />
                      <KeyValueRow label="Hospital?"   value={result.agents.medical.hospital_required ? 'Yes' : 'No'} />
                      <KeyValueRow label="Treatment"   value={result.agents.medical.treatment_steps?.join('; ')} />
                      <KeyValueRow label="Reasoning"   value={result.agents.medical.raw_reasoning} />
                    </AgentDetailCard>

                    <AgentDetailCard
                      label="Civic Agent"
                      icon={Building2}
                      color="text-amber-400"
                      bg="bg-amber-500/10"
                      border="border-amber-500/20"
                      isActive={result.agents.civic.civic_issue_detected}
                    >
                      <KeyValueRow label="Issue Type"    value={result.agents.civic.issue_type || 'None'} />
                      <KeyValueRow label="Authority"     value={result.agents.civic.responsible_authority} />
                      <KeyValueRow label="Report Detail" value={result.agents.civic.report_detail} />
                      <KeyValueRow label="ETA"           value={result.agents.civic.resolution_eta} />
                      <KeyValueRow label="Reasoning"     value={result.agents.civic.raw_reasoning} />
                    </AgentDetailCard>

                    <AgentDetailCard
                      label="Mobility Agent"
                      icon={Car}
                      color="text-cyan-400"
                      bg="bg-cyan-500/10"
                      border="border-cyan-500/20"
                      isActive={result.agents.mobility.mobility_issue_detected}
                    >
                      <KeyValueRow label="Affected Area" value={result.agents.mobility.affected_area || 'None'} />
                      <KeyValueRow label="Reroute?"      value={result.agents.mobility.route_change_required ? 'Yes' : 'No'} />
                      <KeyValueRow label="Delay"         value={result.agents.mobility.estimated_delay || 'None'} />
                      <KeyValueRow label="Alt Routes"    value={result.agents.mobility.alternative_routes?.join('; ') || 'None'} />
                      <KeyValueRow label="Reasoning"     value={result.agents.mobility.raw_reasoning} />
                    </AgentDetailCard>
                  </div>
                </div>

                {/* ── Raw JSON (developer debug, collapsed by default) ── */}
                <details className="group glass rounded-2xl">
                  <summary className="px-5 py-4 text-xs uppercase font-semibold text-slate-500 cursor-pointer hover:text-slate-400 transition-colors select-none flex items-center justify-between">
                    <span>View Structured JSON Output</span>
                    <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="px-5 pb-5">
                    <div className="bg-[#0d1117] border border-slate-800 rounded-xl p-4 overflow-x-auto">
                      <pre className="text-xs text-slate-300 font-mono">
                        {JSON.stringify(result, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>

              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
