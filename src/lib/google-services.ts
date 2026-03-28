import { Client } from '@googlemaps/google-maps-services-js';
import { v2 } from '@google-cloud/translate';
import * as textToSpeech from '@google-cloud/text-to-speech';

let mapClient: Client | null = null;
let translateClient: v2.Translate | null = null;
let ttsClient: textToSpeech.TextToSpeechClient | null = null;

function getMapClient() {
  if (!mapClient) mapClient = new Client({});
  return mapClient;
}

function getTranslateClient() {
  if (!translateClient) {
    // Automatically uses Google Application Default Credentials
    translateClient = new v2.Translate();
  }
  return translateClient;
}

function getTtsClient() {
  if (!ttsClient) {
    ttsClient = new textToSpeech.TextToSpeechClient();
  }
  return ttsClient;
}

/** Reverse geocodes GPS coordinates into a street address */
export async function enrichLocationData(context: string): Promise<string | null> {
  if (!process.env.GOOGLE_MAPS_API_KEY) return null;
  
  // Basic regex to look for lat/lng signatures in the context string
  const latLngMatch = context.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (!latLngMatch) return null;

  try {
    const lat = parseFloat(latLngMatch[1]);
    const lng = parseFloat(latLngMatch[2]);
    const response = await getMapClient().reverseGeocode({
      params: { 
        latlng: { lat, lng }, 
        key: process.env.GOOGLE_MAPS_API_KEY 
      },
      timeout: 2500, // Enforce short timeout to not break strict realtime constraints
    });
    
    const address = response.data.results[0]?.formatted_address;
    if (address) {
      return `Exact Street Location Resolved via Maps API GPS: ${address}`;
    }
  } catch (error) {
    console.warn('[Google Services] Maps API Reverse Geocoding failed:', error);
  }
  return null;
}

/** Translates distress input to English so the agents have accurate reasoning */
export async function translateToEnglish(text: string): Promise<{ translated: string; originalLang: string }> {
  try {
    const client = getTranslateClient();
    const [translation, metadata] = await client.translate(text, 'en');
    return { 
       translated: translation, 
       // Fallback logic to grab detected language
       originalLang: (metadata as any)?.data?.translations?.[0]?.detectedSourceLanguage || 'unknown' 
    };
  } catch (error) {
    console.warn('[Google Services] Cloud Translate API failed (or credentials missing):', error);
    return { translated: text, originalLang: 'unknown' };
  }
}

/** Synthesises TTS fallback for accessibility and rapid audio notification */
export async function generateAudioSummary(summary: string): Promise<string | null> {
    try {
        const client = getTtsClient();
        const request = {
            input: { text: summary },
            // Use Journey voice models for highly natural, empathetic tone.
            voice: { languageCode: 'en-US', name: 'en-US-Journey-D' },
            audioConfig: { audioEncoding: 'MP3' as const },
        };
        
        const [response] = await client.synthesizeSpeech(request);
        if (response.audioContent) {
           return Buffer.from(response.audioContent).toString('base64');
        }
    } catch(err) {
        console.warn('[Google Services] Cloud TTS Synthesize failed (or credentials missing):', err);
    }
    return null;
}
