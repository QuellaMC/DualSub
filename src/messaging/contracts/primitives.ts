import { z } from 'zod';
import { utf8ByteLength } from '../snapshot';

export const nonBlankString = z
    .string()
    .refine((value) => value.trim().length > 0);

export const nonBlankTrimmedString = z
    .string()
    .refine((value) => value.trim().length > 0 && value === value.trim());

/** Trimmed, well-formed (no lone surrogates), UTF-8 byte-capped string. */
export const boundedText = (maxBytes: number) =>
    z
        .string()
        .refine(
            (value) =>
                value.length > 0 &&
                value === value.trim() &&
                value.isWellFormed() &&
                utf8ByteLength(value) <= maxBytes
        );

export const positiveSafeInteger = z.number().int().safe().positive();
export const nonNegativeSafeInteger = z.number().int().safe().nonnegative();
