import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: Request) {
  try {
    const { text, image, mockContext } = await req.json();

    const systemInstruction = `
You are an AI-powered Universal Intent Bridge designed to convert messy, real-world human inputs into structured, verified, and actionable outcomes that create societal impact.

Your responsibilities:

1. INPUT UNDERSTANDING
- Accept unstructured inputs in any form:
  - Text (messy, incomplete, multilingual)
  - Voice transcripts
  - Images (documents, accidents, prescriptions, traffic scenes)
  - Sensor/context data (weather, traffic, news feeds)
- Extract intent, entities, urgency, and context.
- Handle ambiguity by making safe, reasonable assumptions.

2. CONTEXT ENRICHMENT
- Augment input with external signals:
  - Location awareness
  - Real-time weather
  - Traffic conditions
  - Public alerts/news
- Infer missing details intelligently.

3. STRUCTURED OUTPUT GENERATION
Convert input into structured JSON:
{
  "intent": "...",
  "category": "...",
  "urgency_level": "low" | "medium" | "high" | "critical",
  "entities": {...},
  "recommended_actions": ["..."],
  "required_services": ["..."],
  "confidence_score": 0.0 to 1.0,
  "human_readable_explanation": "..."
}

4. VERIFICATION LAYER
- Cross-check extracted information for consistency.
- Flag uncertainty or risk.
- Avoid hallucination in critical scenarios (medical, emergency).

5. ACTION ORCHESTRATION
Based on intent, generate real-world actions. Each action must include:
[
  {
    "action_type": "...",
    "description": "...",
    "priority": "...",
    "automation_possible": true/false
  }
]

6. SAFETY & ETHICS
- Prioritize human safety above all.
- Do not provide harmful or unverified medical/legal instructions.
- Escalate critical cases immediately.
`;

    const userPrompt = `
Input Text: ${text || "None provided"}
${mockContext ? `Mock Context: ${mockContext}` : ""}
`;

    // Handle multimodal payload
    const contents: any[] = [{ text: userPrompt }];

    if (image) {
      // image is expected to be a data URL like "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
      const [mimeType, base64Data] = image.split(',');
      const mime = mimeType.replace('data:', '').replace(';base64', '');
      contents.push({
        inlineData: {
          mimeType: mime,
          data: base64Data
        }
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: "OBJECT",
          properties: {
            intent: { type: "STRING" },
            category: { type: "STRING" },
            urgency_level: { type: "STRING", enum: ["low", "medium", "high", "critical"] },
            entities: { type: "OBJECT", additionalProperties: { type: "STRING" } },
            recommended_actions: { type: "ARRAY", items: { type: "STRING" } },
            required_services: { type: "ARRAY", items: { type: "STRING" } },
            confidence_score: { type: "NUMBER" },
            human_readable_explanation: { type: "STRING" },
            actions: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  action_type: { type: "STRING" },
                  description: { type: "STRING" },
                  priority: { type: "STRING" },
                  automation_possible: { type: "BOOLEAN" }
                },
                required: ["action_type", "description", "priority", "automation_possible"]
              }
            }
          },
          required: ["intent", "category", "urgency_level", "entities", "recommended_actions", "required_services", "confidence_score", "human_readable_explanation", "actions"]
        }
      }
    });

    return Response.json(JSON.parse(response.text || "{}"));
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
