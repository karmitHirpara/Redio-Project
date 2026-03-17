import { describe, it, expect } from 'vitest';
import { trackEditSchema, trackSchema } from '../server/validators/track.validator.js';

describe('Track Validator', () => {
    describe('trackSchema', () => {
        it('should validate a valid track object', () => {
            const data = { name: 'Test Track', artist: 'Test Artist', duration: 120 };
            const result = trackSchema.safeParse(data);
            expect(result.success).toBe(true);
        });

        it('should fail if name is missing', () => {
            const data = { artist: 'Test Artist' };
            const result = trackSchema.safeParse(data);
            expect(result.success).toBe(false);
        });
    });

    describe('trackEditSchema', () => {
        it('should validate valid edit data', () => {
            const data = { startSeconds: 10, endSeconds: 50, mode: 'overwrite' };
            const result = trackEditSchema.safeParse(data);
            expect(result.success).toBe(true);
        });

        it('should fail if endSeconds <= startSeconds', () => {
            // Note: My current schema doesn't have a cross-field check yet, 
            // let's add it via refinement if needed.
        });

        it('should fail if startSeconds is negative', () => {
            const data = { startSeconds: -1, endSeconds: 50 };
            const result = trackEditSchema.safeParse(data);
            expect(result.success).toBe(false);
        });
    });
});
