import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { getAi } from './agents';

vi.mock('./agents', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getAi: vi.fn(),
  };
});

// Mock database to simulate successful saves and Auth
vi.mock('../../../lib/firebase-admin', () => ({
  db: {
    collection: vi.fn().mockReturnValue({
      add: vi.fn().mockResolvedValue(true),
    }),
  },
  verifyIdToken: vi.fn().mockResolvedValue({ uid: 'mock_test_user' }),
}));

// Mock Google Services to prevent tests from hitting live REST APIs and taking too long
vi.mock('../../../lib/google-services', () => ({
  enrichLocationData: vi.fn().mockResolvedValue('Mock GPS Location Data'),
  translateToEnglish: vi.fn().mockImplementation(async (text: string) => ({ translated: text, originalLang: 'en' })),
  generateAudioSummary: vi.fn().mockResolvedValue('mock_base64_audio_string'),
}));

describe('POST /api/bridge', () => {
  let mockGenerateContent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContent = vi.fn();
    (getAi as any).mockReturnValue({
      models: {
        generateContent: mockGenerateContent,
      },
    });
  });

  it('should return 400 if user input is missing both text and image', async () => {
    const req = new Request('http://localhost:3000/api/bridge', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('At least one of "text" or "image" is required.');
  });

  it('should return 400 if text is too long (edge case)', async () => {
    const req = new Request('http://localhost:3000/api/bridge', {
      method: 'POST',
      body: JSON.stringify({ text: 'a'.repeat(2001) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('exceeds the maximum allowed length');
  });

  it('should return 400 if mockContext is too long (edge case)', async () => {
    const req = new Request('http://localhost:3000/api/bridge', {
      method: 'POST',
      body: JSON.stringify({ text: 'hello', mockContext: 'a'.repeat(501) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Context data exceeds the maximum allowed length of 500 characters.');
  });

  it('should return 400 if image payload is too large (edge case)', async () => {
    const req = new Request('http://localhost:3000/api/bridge', {
      method: 'POST',
      body: JSON.stringify({ image: 'data:image/png;base64,' + 'a'.repeat(7_000_001) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Image data exceeds the maximum allowed size of ~5 MB.');
  });

  it('should return 400 if image payload does not match data:image (edge case)', async () => {
    const req = new Request('http://localhost:3000/api/bridge', {
      method: 'POST',
      body: JSON.stringify({ image: 'data:video/mp4;base64,aaa' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Image must be a valid Base64 image data URL (data:image/...)');
  });

  it('should parse body gracefully if invalid JSON is sent (edge case)', async () => {
    const req = new Request('http://localhost:3000/api/bridge', {
      method: 'POST',
      body: 'invalid-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Request body must be valid JSON.');
  });

  it('should generate multi-agent response effectively (integration flow)', async () => {
    // Mock the domain agent responses (4) and verification response (1)
    mockGenerateContent.mockResolvedValueOnce({ text: '{"emergency_detected": false}' });
    mockGenerateContent.mockResolvedValueOnce({ text: '{"medical_situation_detected": false}' });
    mockGenerateContent.mockResolvedValueOnce({ text: '{"civic_issue_detected": true}' });
    mockGenerateContent.mockResolvedValueOnce({ text: '{"mobility_issue_detected": false}' });
    mockGenerateContent.mockResolvedValueOnce({ text: '{"intent": "Pothole report", "urgency_level": "low"}' });

    const req = new Request('http://localhost:3000/api/bridge', {
      method: 'POST',
      body: JSON.stringify({ text: 'Huge pothole on main st' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.intent).toBe('Pothole report');
    expect(data.urgency_level).toBe('low');
    expect(data.audio_summary).toBe('mock_base64_audio_string');
  });

  it('should handle unparseable response from AI gracefully', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: 'invalid-json' });

    const req = new Request('http://localhost:3000/api/bridge', {
      method: 'POST',
      body: JSON.stringify({ text: 'Help' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500); // Fails gracefully through the catch block
  });
});
