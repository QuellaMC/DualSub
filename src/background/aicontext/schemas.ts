import { z } from 'zod';
import {
    aiAnswer,
    MAX_ANSWER_EXAMPLES,
    MAX_ANSWER_SIMILAR,
    type AiAnswer,
} from '@/messaging/contracts/analyzeContext';
import type { ContextType } from '@/shared/contextTypes';

export const ANALYSIS_SCHEMA_NAME = 'word_explanation';

/** The answer fields each kind of explanation adds to the meaning in the
 *  line and how the words sound. */
const KIND_FIELDS = {
    linguistic: { examples: true, similar: true, tip: true },
    cultural: { culture: true },
    historical: { history: true },
} as const satisfies Record<ContextType, Partial<Record<keyof AiAnswer, true>>>;

/** The answer asked of the model: every field it is asked for is required,
 *  and nothing else may appear. */
export function answerShape(kinds: readonly ContextType[]) {
    return aiAnswer
        .pick({
            meaning: true,
            register: true,
            ...Object.assign({}, ...kinds.map((kind) => KIND_FIELDS[kind])),
        })
        .required();
}

/** A schema without its array caps: not every endpoint accepts them, so an
 *  answer that runs over is cut to them on arrival instead. */
function withoutItemCaps(schema: unknown): unknown {
    if (Array.isArray(schema)) {
        return schema.map(withoutItemCaps);
    }
    if (schema === null || typeof schema !== 'object') {
        return schema;
    }
    return Object.fromEntries(
        Object.entries(schema)
            .filter(([key]) => key !== 'maxItems')
            .map(([key, value]) => [key, withoutItemCaps(value)])
    );
}

/** The JSON Schema sent to the model as its response format. */
export function answerJsonSchema(
    kinds: readonly ContextType[]
): Record<string, unknown> {
    const { $schema: _draft, ...schema } = z.toJSONSchema(answerShape(kinds));
    return withoutItemCaps(schema) as Record<string, unknown>;
}

function capped(value: unknown): unknown {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }
    const answer = value as Record<string, unknown>;
    return {
        ...answer,
        ...(Array.isArray(answer.examples)
            ? { examples: answer.examples.slice(0, MAX_ANSWER_EXAMPLES) }
            : {}),
        ...(Array.isArray(answer.similar)
            ? { similar: answer.similar.slice(0, MAX_ANSWER_SIMILAR) }
            : {}),
    };
}

/** The model's parsed JSON, or null when it does not match the shape. */
export function parseAnswer(
    kinds: readonly ContextType[],
    value: unknown
): AiAnswer | null {
    const parsed = answerShape(kinds).safeParse(capped(value));
    return parsed.success ? parsed.data : null;
}
