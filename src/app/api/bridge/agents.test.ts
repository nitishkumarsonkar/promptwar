import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildContents, buildVerificationSystem, getAi } from './agents';

describe('agents helper functions', () => {
  describe('getAi', () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env.GEMINI_API_KEY;
    });

    afterEach(() => {
      // Restore previous environment state so we don't break subsequent tests
      process.env.GEMINI_API_KEY = originalEnv;
    });

    it('should throw an error if GEMINI_API_KEY is not set', () => {
      delete process.env.GEMINI_API_KEY;
      expect(() => getAi()).toThrow(/GEMINI_API_KEY environment variable is not set/);
    });

    it('should return GoogleGenAI instance when GEMINI_API_KEY is set', () => {
      process.env.GEMINI_API_KEY = 'mock_api_key';
      const ai = getAi();
      expect(ai).toBeDefined();
    });
  });

  describe('buildContents', () => {
    it('should build text prompt correctly without image', () => {
      const parts = buildContents('hello world');
      expect(parts).toHaveLength(1);
      expect(parts[0]).toEqual({ text: 'hello world' });
    });

    it('should build text and image successfully', () => {
      const parts = buildContents('hello world', 'data:image/jpeg;base64,aabbcc');
      expect(parts).toHaveLength(2);
      expect(parts[1]).toEqual({
        inlineData: { mimeType: 'image/jpeg', data: 'aabbcc' }
      });
    });

    it('should skip malformed image data url gracefully (edge case)', () => {
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const parts = buildContents('hello world', 'invalid-data-url');
      expect(parts).toHaveLength(1);
      expect(consoleWarnMock).toHaveBeenCalled();
      consoleWarnMock.mockRestore();
    });
  });

  describe('buildVerificationSystem', () => {
    it('should embed domain agent outputs into system instruction string', () => {
      const emergency: any = { emergency_detected: true };
      const medical: any = { medical_situation_detected: false };
      const civic: any = { civic_issue_detected: false };
      const mobility: any = { mobility_issue_detected: true };

      const system = buildVerificationSystem(emergency, medical, civic, mobility);

      expect(system).toContain('EMERGENCY AGENT OUTPUT');
      expect(system).toContain('"emergency_detected": true');
      expect(system).toContain('"mobility_issue_detected": true');
    });
  });
});
