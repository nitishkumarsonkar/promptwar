import { describe, it, expect, vi } from 'vitest';
import { buildContents, buildVerificationSystem } from './agents';

describe('agents helper functions', () => {
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
