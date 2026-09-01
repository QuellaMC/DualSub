export const CONTEXT_TYPES = ['cultural', 'historical', 'linguistic'] as const;

export type ContextType = (typeof CONTEXT_TYPES)[number];
