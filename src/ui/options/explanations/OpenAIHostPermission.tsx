import { useRef, useState } from 'react';
import {
    requestHostPermission,
    toHostPermissionPattern,
} from '@/shared/hostPermissions';
import type { Translate } from '../../hooks/useI18n';
import { errorMessage } from '../types';

type HostPermissionStatus = {
    readonly baseUrl: string;
    readonly state: 'pending' | 'granted' | 'denied' | 'error';
    readonly message: string;
} | null;

function hostLabel(baseUrl: string): string {
    try {
        return new URL(baseUrl).host;
    } catch {
        return baseUrl;
    }
}

function hostPermissionScope(baseUrl: string): string {
    try {
        return toHostPermissionPattern(baseUrl);
    } catch {
        return '';
    }
}

export function OpenAIHostPermission({
    t,
    baseUrl,
    valid,
    onAnswer,
}: {
    t: Translate;
    baseUrl: string;
    valid: boolean;
    /** Told once the prompt is answered, so readiness can be read again. */
    onAnswer: () => void;
}) {
    const [status, setStatus] = useState<HostPermissionStatus>(null);
    const sequence = useRef(0);
    const current = status?.baseUrl === baseUrl ? status : null;
    const state = current?.state ?? 'idle';
    const pending = state === 'pending';
    const scope = hostPermissionScope(baseUrl);

    const request = (): void => {
        if (!valid) {
            return;
        }
        sequence.current += 1;
        const mine = sequence.current;
        const requested = baseUrl;
        setStatus({
            baseUrl: requested,
            state: 'pending',
            message: t('openaiHostPermissionChecking'),
        });
        // The prompt must open inside this click: no await before it.
        let permission: Promise<boolean>;
        try {
            permission = requestHostPermission(requested);
        } catch (error) {
            setStatus({
                baseUrl: requested,
                state: 'error',
                message: t('openaiHostPermissionError', errorMessage(error)),
            });
            return;
        }
        void permission.then(
            (granted) => {
                onAnswer();
                if (mine !== sequence.current) {
                    return;
                }
                setStatus({
                    baseUrl: requested,
                    state: granted ? 'granted' : 'denied',
                    message: t(
                        granted
                            ? 'openaiHostPermissionGranted'
                            : 'openaiHostPermissionDenied'
                    ),
                });
            },
            (error: unknown) => {
                if (mine !== sequence.current) {
                    return;
                }
                setStatus({
                    baseUrl: requested,
                    state: 'error',
                    message: t(
                        'openaiHostPermissionError',
                        errorMessage(error)
                    ),
                });
            }
        );
    };

    return (
        <div
            className={`api-host-permission ${state}`}
            role="group"
            aria-labelledby="openaiHostPermissionHost"
        >
            <div className="api-host-permission-heading">
                <span className="api-host-permission-icon" aria-hidden="true">
                    <svg viewBox="0 0 20 20">
                        <path d="M10 1.75 16 4v4.2c0 4.05-2.42 7.68-6 9.3-3.58-1.62-6-5.25-6-9.3V4l6-2.25Z" />
                        {state === 'granted' && (
                            <path d="m7.15 9.7 1.75 1.75 3.95-4.1" />
                        )}
                        {(state === 'denied' || state === 'error') && (
                            <path d="M10 6.25v4.25m0 2.5h.01" />
                        )}
                    </svg>
                </span>
                <span id="openaiHostPermissionHost">{hostLabel(baseUrl)}</span>
            </div>
            <button
                type="button"
                className="api-host-permission-button"
                onClick={request}
                disabled={pending || !valid}
                aria-busy={pending}
            >
                {t('openaiHostPermissionButton')}
            </button>
            {scope !== '' && (
                <span className="api-host-permission-status">
                    {t('openaiHostPermissionScope', baseUrl, scope)}
                </span>
            )}
            <span className="api-host-permission-status" role="status">
                {current?.message ?? ''}
            </span>
        </div>
    );
}
