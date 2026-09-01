import type { z } from 'zod';
import type { SenderRole } from './sender';
import type { SnapshotLimits } from './snapshot';
import type { MessageAction } from './actions';

/**
 * One declarative entry per cross-context action: who may send it, over which
 * transport, the exact request/response shapes, and the pre-parse snapshot
 * budget. TS request/response types derive from the schemas; the router and
 * client both consume the same entry, so a contract cannot drift between
 * sender and receiver.
 */
export interface MessageContract<
    A extends MessageAction = MessageAction,
    Req extends z.ZodType = z.ZodType,
    Res extends z.ZodType = z.ZodType,
> {
    readonly action: A;
    /** 'runtime': to the background. 'tab': background/popup → content tab. */
    readonly transport: 'runtime' | 'tab';
    readonly senders: readonly SenderRole[];
    readonly request: Req;
    readonly response: Res;
    /** Role-specific request variants (analyzeContext). */
    readonly requestByRole?: Partial<Record<SenderRole, z.ZodType>>;
    /** Snapshot budget applied before parsing; module default otherwise. */
    readonly budget?: SnapshotLimits;
}

export const defineContract = <
    A extends MessageAction,
    Req extends z.ZodType,
    Res extends z.ZodType,
>(
    contract: MessageContract<A, Req, Res>
): MessageContract<A, Req, Res> => Object.freeze(contract);

export type RequestOf<C extends MessageContract> = z.infer<C['request']>;
export type ResponseOf<C extends MessageContract> = z.infer<C['response']>;
