/**
 * @file agents.ts
 * @description Shared Gemini AI client, agent output type definitions,
 * domain system-instruction strings, and multimodal content helpers
 * for the Universal Intent Bridge multi-agent pipeline.
 *
 * Architecture:
 *   - 4 domain agents (EmergencyAgent, MedicalAgent, CivicAgent, MobilityAgent)
 *     run in parallel using the fast Flash model.
 *   - 1 verification agent synthesises all domain outputs using the Pro model.
 */

import { GoogleGenAI, type Part } from '@google/genai';

// ---------------------------------------------------------------------------
// Runtime environment validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared Gemini client
// ---------------------------------------------------------------------------

let _aiInstance: GoogleGenAI | null = null;

export const getAi = () => {
  if (!_aiInstance) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        '[Bridge/agents] GEMINI_API_KEY environment variable is not set. ' +
          'Copy .env.example to .env and supply a valid key.'
      );
    }
    _aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
  }
  return _aiInstance;
};

// ---------------------------------------------------------------------------
// Model identifiers
// ---------------------------------------------------------------------------

/**
 * Fast Flash model used for the 4 parallel domain agents.
 * Prioritises low latency for real-time decision support.
 */
export const FLASH_MODEL = 'gemini-2.5-flash' as const;

/**
 * Full Pro model reserved for the final verification/orchestration pass.
 * Prioritises reasoning quality and cross-agent consistency checking.
 */
export const PRO_MODEL = 'gemini-2.5-pro' as const;

// ---------------------------------------------------------------------------
// Multimodal content builder
// ---------------------------------------------------------------------------

/**
 * Constructs a Gemini `Part[]` array from a text prompt and an optional
 * Base64-encoded image data URL (e.g. `data:image/jpeg;base64,...`).
 *
 * The image data URL is parsed as:
 *   `data:<mimeType>;base64,<base64Data>`
 *
 * @param textPrompt   - The user or agent text prompt.
 * @param imageDataUrl - Optional Base64 image data URL from the frontend.
 * @returns            Array of `Part` objects suitable for `generateContent`.
 */
export function buildContents(textPrompt: string, imageDataUrl?: string): Part[] {
  const parts: Part[] = [{ text: textPrompt }];

  if (imageDataUrl) {
    // Data URL format: "data:<mimeType>;base64,<data>"
    const commaIndex = imageDataUrl.indexOf(',');
    if (commaIndex === -1) {
      // Malformed data URL — skip image silently rather than crashing the pipeline.
      console.warn('[Bridge/agents] buildContents: malformed imageDataUrl, skipping image part.');
      return parts;
    }

    // Strip the leading "data:" prefix to isolate "<mimeType>;base64"
    const metaPart = imageDataUrl.substring('data:'.length, commaIndex);
    const mimeType = metaPart.replace(';base64', '');
    const base64Data = imageDataUrl.substring(commaIndex + 1);

    parts.push({ inlineData: { mimeType, data: base64Data } });
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Per-agent TypeScript types
// ---------------------------------------------------------------------------

/** Output produced by the Emergency domain agent. */
export interface EmergencyAgentOutput {
  emergency_detected: boolean;
  emergency_type: string;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  dispatch_required: boolean;
  sos_actions: string[];
  raw_reasoning: string;
}

/** Output produced by the Medical domain agent. */
export interface MedicalAgentOutput {
  medical_situation_detected: boolean;
  conditions: string[];
  medications_mentioned: string[];
  treatment_steps: string[];
  hospital_required: boolean;
  raw_reasoning: string;
}

/** Output produced by the Civic/infrastructure domain agent. */
export interface CivicAgentOutput {
  civic_issue_detected: boolean;
  issue_type: string;
  responsible_authority: string;
  report_detail: string;
  resolution_eta: string;
  raw_reasoning: string;
}

/** Output produced by the Mobility/transport domain agent. */
export interface MobilityAgentOutput {
  mobility_issue_detected: boolean;
  route_change_required: boolean;
  affected_area: string;
  estimated_delay: string;
  alternative_routes: string[];
  raw_reasoning: string;
}

/** A single automated or simulated action with its readiness status. */
export interface SimulationAction {
  action: string;
  status: 'simulated' | 'ready_for_api' | 'requires_user';
}

/** Output produced by the Verification/orchestration agent. */
export interface VerificationAgentOutput {
  intent: string;
  urgency_level: 'low' | 'medium' | 'high' | 'critical';
  recommended_actions: string[];
  next_best_action: string;
  next_3_steps: string[];
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

/** Unified response returned by the `/api/bridge` POST endpoint. */
export interface MultiAgentResponse {
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

// ---------------------------------------------------------------------------
// Domain agent system instructions
// ---------------------------------------------------------------------------

/**
 * System instruction for the Emergency domain agent.
 *
 * SAFETY RULE: When in doubt, flag as critical. Human life > accuracy.
 */
export const EMERGENCY_SYSTEM = `
You are the Emergency Agent of a multi-agent AI decision engine.
Your ONLY job: detect life-threatening situations and output a structured JSON.

Analyse the user input for:
- Accidents (road, home, workplace)
- Medical emergencies (cardiac arrest, stroke, unconsciousness, severe bleeding)
- Fire, flood, natural disasters
- Criminal incidents (assault, kidnapping)

Output JSON matching this exact schema:
{
  "emergency_detected": boolean,
  "emergency_type": "string — e.g. cardiac_arrest, road_accident, none",
  "severity": "none | low | medium | high | critical",
  "dispatch_required": boolean,
  "sos_actions": ["array of immediate actions, e.g. Call ambulance now"],
  "raw_reasoning": "1-2 sentence explanation of your decision"
}

SAFETY RULE: When in doubt, flag as critical. Human life > accuracy.
`.trim();

/**
 * System instruction for the Medical domain agent.
 *
 * SAFETY RULE: Never recommend specific drug dosages. Always defer to a doctor.
 */
export const MEDICAL_SYSTEM = `
You are the Medical Agent of a multi-agent AI decision engine.
Your ONLY job: detect medical situations and output a structured JSON.

Analyse input for:
- Described symptoms (pain, fever, nausea, breathing difficulty)
- Medications or prescriptions mentioned or visible in images
- Injury descriptions
- Mental health crisis indicators

Output JSON matching this exact schema:
{
  "medical_situation_detected": boolean,
  "conditions": ["list of detected or suspected conditions"],
  "medications_mentioned": ["list of medications or drug names"],
  "treatment_steps": ["step-by-step immediate care actions"],
  "hospital_required": boolean,
  "raw_reasoning": "1-2 sentence explanation"
}

SAFETY RULE: Never recommend specific drug dosages. Always recommend consulting a doctor.
Do not hallucinate diagnoses. If uncertain, say so in raw_reasoning.
`.trim();

/**
 * System instruction for the Civic/infrastructure domain agent.
 */
export const CIVIC_SYSTEM = `
You are the Civic Agent of a multi-agent AI decision engine.
Your ONLY job: detect civic/infrastructure issues and output structured JSON.

Detect:
- Pothole, road damage, waterlogging
- Power outage, electricity hazards
- Water supply issues, sewage overflow
- Public property damage
- Pollution incidents

Output JSON matching this exact schema:
{
  "civic_issue_detected": boolean,
  "issue_type": "string — e.g. pothole, power_outage, water_contamination, none",
  "responsible_authority": "e.g. Municipal Corporation, BESCOM, BWSSB",
  "report_detail": "concise description of what to report",
  "resolution_eta": "realistic ETA e.g. 2-4 hours, 1-3 days",
  "raw_reasoning": "1-2 sentence explanation"
}
`.trim();

/**
 * System instruction for the Mobility/transport domain agent.
 */
export const MOBILITY_SYSTEM = `
You are the Mobility Agent of a multi-agent AI decision engine.
Your ONLY job: detect traffic, transport, and logistics issues and output structured JSON.

Detect:
- Traffic congestion, accidents blocking roads
- Route diversions needed
- Public transport disruptions
- Logistics or delivery urgency

Output JSON matching this exact schema:
{
  "mobility_issue_detected": boolean,
  "route_change_required": boolean,
  "affected_area": "string — area or road name",
  "estimated_delay": "e.g. 20-30 minutes, none",
  "alternative_routes": ["list of suggested alternative routes or advice"],
  "raw_reasoning": "1-2 sentence explanation"
}
`.trim();

// ---------------------------------------------------------------------------
// Verification agent system instruction builder
// ---------------------------------------------------------------------------

/**
 * Builds the system instruction for the Verification agent by embedding
 * the structured outputs from all 4 domain agents into the prompt.
 *
 * The Verification agent cross-checks domain outputs, resolves conflicts,
 * and produces the final unified response with a trust score.
 *
 * Priority rule: HUMAN LIFE > SPEED > COMPLETENESS
 * If uncertain in a critical case → default to the safest available action.
 *
 * @param emergency - Output from the Emergency domain agent.
 * @param medical   - Output from the Medical domain agent.
 * @param civic     - Output from the Civic domain agent.
 * @param mobility  - Output from the Mobility domain agent.
 * @returns         System instruction string for the Verification agent.
 */
export function buildVerificationSystem(
  emergency: EmergencyAgentOutput,
  medical: MedicalAgentOutput,
  civic: CivicAgentOutput,
  mobility: MobilityAgentOutput
): string {
  return `
You are the Verification Agent and Chief Orchestrator of a 5-agent AI decision engine.
You receive structured outputs from 4 specialist agents and must synthesise them into a
single, unified, trust-scored response that prioritises human safety above all else.

--- EMERGENCY AGENT OUTPUT ---
${JSON.stringify(emergency, null, 2)}

--- MEDICAL AGENT OUTPUT ---
${JSON.stringify(medical, null, 2)}

--- CIVIC AGENT OUTPUT ---
${JSON.stringify(civic, null, 2)}

--- MOBILITY AGENT OUTPUT ---
${JSON.stringify(mobility, null, 2)}

Your tasks:
1. Cross-check all 4 agent outputs for consistency and conflict.
2. Determine the unified urgency_level (highest from all active agents wins).
3. Assign a confidence_score (0.0–1.0) based on consistency and signal quality.
4. Generate next_best_action (single most important thing to do right now).
5. Generate next_3_steps (ordered list of the 3 most important follow-up actions).
6. Generate simulation actions (what automated systems would do, with status).
7. Flag any risk_flags (uncertainty, conflicting data, missing info).
8. Assign status: "verified", "needs_confirmation", or "critical_uncertain".

Priority rule: HUMAN LIFE > SPEED > COMPLETENESS
If uncertain in a critical case → default to safest action.

Output JSON matching this exact schema:
{
  "intent": "short plain-English description of what the user is dealing with",
  "urgency_level": "low | medium | high | critical",
  "recommended_actions": ["up to 5 recommended actions"],
  "next_best_action": "single most critical action right now",
  "next_3_steps": ["step 1", "step 2", "step 3"],
  "confidence_score": 0.0,
  "risk_flags": ["any concerns or uncertainties"],
  "status": "verified | needs_confirmation | critical_uncertain",
  "simulation": [
    { "action": "Calling ambulance to reported location", "status": "simulated" },
    { "action": "Notifying nearest hospital ER", "status": "ready_for_api" }
  ],
  "explanation": {
    "why_this_action": "reason for the top recommendation",
    "risk_if_ignored": "what happens if user ignores this",
    "estimated_time_to_resolution": "realistic timeframe"
  },
  "human_readable_summary": "2-3 sentence plain English summary for a non-technical user"
}
`.trim();
}
