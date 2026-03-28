/**
 * @file route.ts
 * @description POST /api/bridge — Next.js Route Handler that orchestrates the
 * Universal Intent Bridge 5-agent AI decision pipeline.
 *
 * Pipeline:
 *   Phase 1 — 4 domain agents run in parallel using Gemini Flash.
 *   Phase 2 — 1 Verification agent synthesises all outputs using Gemini Pro.
 *   Phase 3 — Unified MultiAgentResponse is returned to the client.
 *
 * Security:
 *   - Input size is capped to prevent oversized payloads from abusing the API.
 *   - The Gemini API key lives only in server-side env; no secrets reach the client.
 *   - Raw AI model errors are never surfaced to the caller to avoid leaking internals.
 */

import {
  getAi,
  FLASH_MODEL,
  PRO_MODEL,
  buildContents,
  buildVerificationSystem,
  EMERGENCY_SYSTEM,
  MEDICAL_SYSTEM,
  CIVIC_SYSTEM,
  MOBILITY_SYSTEM,
  type EmergencyAgentOutput,
  type MedicalAgentOutput,
  type CivicAgentOutput,
  type MobilityAgentOutput,
  type VerificationAgentOutput,
  type MultiAgentResponse,
} from './agents';
import { db } from '../../../lib/firebase-admin';


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed character length for user text input. */
const MAX_TEXT_LENGTH = 2000;

/** Maximum allowed character length for the mock context/sensor string. */
const MAX_CONTEXT_LENGTH = 500;

/**
 * Maximum allowed byte size for a base64-encoded image data URL (~5 MB of
 * original image data becomes ~6.7 MB as base64).
 */
const MAX_IMAGE_BYTES = 7_000_000;

// ---------------------------------------------------------------------------
// Request type exposed to the frontend
// ---------------------------------------------------------------------------

/**
 * Shape of the JSON body accepted by POST /api/bridge.
 * All fields are optional individually, but at least one of `text` or `image`
 * must be present for the request to be valid.
 */
export interface BridgeRequest {
  /** Unstructured text input from the user. */
  text?: string;
  /** Base64-encoded image data URL (e.g. `data:image/jpeg;base64,...`). */
  image?: string;
  /** Optional sensor/context metadata string (GPS, weather, etc.). */
  mockContext?: string;
}

// ---------------------------------------------------------------------------
// Internal helper — call a Flash domain agent and parse its JSON output
// ---------------------------------------------------------------------------

/**
 * Sends a prompt to a Gemini Flash domain agent and parses the JSON response.
 *
 * Uses `responseMimeType: 'application/json'` to enforce structured output
 * and avoid prose contamination in the model's response.
 *
 * @template T - The expected shape of the agent's JSON output.
 * @param systemInstruction - The agent's role/task system instruction.
 * @param userText          - The combined user input prompt.
 * @param imageDataUrl      - Optional Base64 image data URL.
 * @returns                 Parsed agent output as type T.
 * @throws                  If the model returns non-parseable output.
 */
async function callDomainAgent<T>(
  systemInstruction: string,
  userText: string,
  imageDataUrl?: string
): Promise<T> {
  const parts = buildContents(userText, imageDataUrl);
  const response = await getAi().models.generateContent({
    model: FLASH_MODEL,
    contents: parts,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
    },
  });

  // Fallback to empty object so JSON.parse never throws on null/undefined.
  return JSON.parse(response.text ?? '{}') as T;
}

// ---------------------------------------------------------------------------
// Internal helper — Verification agent (Pro model)
// ---------------------------------------------------------------------------

/**
 * Runs the Verification agent which synthesises outputs from all 4 domain
 * agents into a single, trust-scored, unified response.
 *
 * @param emergency    - Output from the Emergency domain agent.
 * @param medical      - Output from the Medical domain agent.
 * @param civic        - Output from the Civic domain agent.
 * @param mobility     - Output from the Mobility domain agent.
 * @param userText     - Original user prompt (included for context).
 * @param imageDataUrl - Optional Base64 image data URL.
 * @returns            Parsed VerificationAgentOutput.
 */
async function callVerificationAgent(
  emergency: EmergencyAgentOutput,
  medical: MedicalAgentOutput,
  civic: CivicAgentOutput,
  mobility: MobilityAgentOutput,
  userText: string,
  imageDataUrl?: string
): Promise<VerificationAgentOutput> {
  const systemInstruction = buildVerificationSystem(emergency, medical, civic, mobility);
  const userPrompt = `Original user input: "${userText || '(no text — image/context only)'}"`;
  const parts = buildContents(userPrompt, imageDataUrl);

  const response = await getAi().models.generateContent({
    model: PRO_MODEL,
    contents: parts,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
    },
  });

  return JSON.parse(response.text ?? '{}') as VerificationAgentOutput;
}

// ---------------------------------------------------------------------------
// Input validation helper
// ---------------------------------------------------------------------------

/**
 * Validates and sanitises the incoming BridgeRequest.
 *
 * @param body - Raw parsed request body.
 * @returns    An error message string if invalid, or `null` if the body is valid.
 */
function validateBridgeRequest(body: BridgeRequest): string | null {
  const { text, image, mockContext } = body;

  if (!text && !image) {
    return 'At least one of "text" or "image" is required.';
  }

  if (text && text.length > MAX_TEXT_LENGTH) {
    return `Text input exceeds the maximum allowed length of ${MAX_TEXT_LENGTH} characters.`;
  }

  if (mockContext && mockContext.length > MAX_CONTEXT_LENGTH) {
    return `Context data exceeds the maximum allowed length of ${MAX_CONTEXT_LENGTH} characters.`;
  }

  if (image && image.length > MAX_IMAGE_BYTES) {
    return 'Image data exceeds the maximum allowed size of ~5 MB.';
  }

  // Validate image data URL format without logging its content.
  if (image && !image.startsWith('data:image/')) {
    return 'Image must be a valid Base64 image data URL (data:image/...)';
  }

  return null;
}

// ---------------------------------------------------------------------------
// POST /api/bridge — main route handler
// ---------------------------------------------------------------------------

/**
 * Next.js Route Handler for POST /api/bridge.
 *
 * Orchestrates the full 5-agent pipeline:
 *   1. Validates the incoming request.
 *   2. Runs 4 domain agents in parallel (Gemini Flash).
 *   3. Feeds all domain outputs to the Verification agent (Gemini Pro).
 *   4. Returns the unified MultiAgentResponse to the client.
 *
 * Error handling:
 *   - Returns HTTP 400 for invalid/missing input.
 *   - Returns HTTP 500 for pipeline failures, without leaking internal details.
 *
 * @param req - The incoming Next.js HTTP request.
 * @returns   A JSON Response containing MultiAgentResponse or an error payload.
 */
export async function POST(req: Request): Promise<Response> {
  // ── Parse and validate input ───────────────────────────────────────────────
  let body: BridgeRequest;
  try {
    body = (await req.json()) as BridgeRequest;
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const validationError = validateBridgeRequest(body);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  const { text, image, mockContext } = body;

  // Build a combined prompt string for all domain agents.
  // NOTE: mockContext is intentionally not logged to avoid capturing sensor PII.
  const userPrompt = [
    text ? `User Input: ${text}` : null,
    mockContext ? `Context/Sensor Data: ${mockContext}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  console.info(
    `[Bridge API] Request received — textLen=${text?.length ?? 0} hasImage=${!!image} hasContext=${!!mockContext}`
  );

  try {
    // ── Phase 1: Run 4 domain agents in parallel (Gemini Flash) ──────────────
    console.info('[Bridge API] Phase 1: Starting parallel domain agent analysis.');

    const [emergency, medical, civic, mobility] = await Promise.all([
      callDomainAgent<EmergencyAgentOutput>(EMERGENCY_SYSTEM, userPrompt, image),
      callDomainAgent<MedicalAgentOutput>(MEDICAL_SYSTEM, userPrompt, image),
      callDomainAgent<CivicAgentOutput>(CIVIC_SYSTEM, userPrompt, image),
      callDomainAgent<MobilityAgentOutput>(MOBILITY_SYSTEM, userPrompt, image),
    ]);

    console.info(
      `[Bridge API] Phase 1 complete — ` +
        `emergency.severity=${emergency.severity} ` +
        `medical.detected=${medical.medical_situation_detected} ` +
        `civic.detected=${civic.civic_issue_detected} ` +
        `mobility.detected=${mobility.mobility_issue_detected}`
    );

    // ── Phase 2: Verification + orchestration (Gemini Pro) ────────────────────
    console.info('[Bridge API] Phase 2: Starting verification agent synthesis.');

    const verification = await callVerificationAgent(
      emergency,
      medical,
      civic,
      mobility,
      userPrompt,
      image
    );

    console.info(
      `[Bridge API] Phase 2 complete — ` +
        `urgency=${verification.urgency_level} ` +
        `confidence=${verification.confidence_score} ` +
        `status=${verification.status}`
    );

    // ── Phase 3: Compose and return unified response ───────────────────────────
    const multiAgentResponse: MultiAgentResponse = {
      intent: verification.intent,
      urgency_level: verification.urgency_level,
      agents: { emergency, medical, civic, mobility },
      next_best_action: verification.next_best_action,
      next_3_steps: verification.next_3_steps ?? [],
      recommended_actions: verification.recommended_actions ?? [],
      confidence_score: verification.confidence_score,
      risk_flags: verification.risk_flags ?? [],
      status: verification.status,
      simulation: verification.simulation ?? [],
      explanation: verification.explanation,
      human_readable_summary: verification.human_readable_summary,
    };

    if (db) {
      try {
        await db.collection('bridge_evaluations').add({
          intent: verification.intent || 'unknown',
          urgency: verification.urgency_level || 'unknown',
          status: verification.status || 'unknown',
          timestamp: new Date().toISOString(),
          // Avoiding storing original PII like text/image
        });
        console.info('[Bridge API] Saved evaluation result to Google Cloud Firestore.');
      } catch (dbError) {
        console.error('[Bridge API] Firestore save error (Google Cloud setup may be incomplete):', dbError);
      }
    }

    console.info('[Bridge API] Pipeline complete. Returning unified response.');
    return Response.json(multiAgentResponse);
  } catch (error: unknown) {
    // Log the full error server-side for debugging, but return a generic
    // message to the client to avoid leaking internal details.
    const internalMessage = error instanceof Error ? error.message : String(error);
    console.error('[Bridge API] Pipeline error during agent orchestration:', internalMessage);

    return Response.json(
      { error: 'Failed to process the request. Please try again.' },
      { status: 500 }
    );
  }
}
