import { useRef } from 'react';
import { validateSetting } from '@/config/schema';
import { VERTEX_LOCATIONS, type VertexLocation } from '@/shared/providers';
import type { Translate } from '../../hooks/useI18n';
import { useCommittedTextField } from '../../hooks/useCommittedTextField';
import { FieldError } from '../FieldError';
import { FileButton } from '../FileButton';
import { useVertexCheck } from '../hooks/useVertexCheck';
import { SettingCard } from '../SettingCard';
import { SparkleButton } from '../SparkleButton';
import { TestResultDisplay } from '../TestResultDisplay';
import type { OptionsSettings, SaveSettings } from '../types';

function isVertexLocation(value: string): value is VertexLocation {
    return (VERTEX_LOCATIONS as readonly string[]).includes(value);
}

export function VertexProviderCard({
    t,
    settings,
    save,
}: {
    t: Translate;
    settings: Pick<
        OptionsSettings,
        | 'vertexAccessToken'
        | 'vertexProjectId'
        | 'vertexLocation'
        | 'vertexModel'
        | 'vertexTokenExpiresAt'
    >;
    save: SaveSettings;
}) {
    const fileInput = useRef<HTMLInputElement | null>(null);
    const check = useVertexCheck(
        t,
        {
            accessToken: settings.vertexAccessToken,
            projectId: settings.vertexProjectId,
            location: settings.vertexLocation,
            model: settings.vertexModel,
        },
        settings.vertexTokenExpiresAt,
        save
    );
    const projectIdField = useCommittedTextField({
        value: settings.vertexProjectId,
        validate: (draft) => validateSetting('vertexProjectId', draft),
        onCommit: (draft) => save({ vertexProjectId: draft }),
    });
    const modelField = useCommittedTextField({
        value: settings.vertexModel,
        validate: (draft) => validateSetting('vertexModel', draft),
        onCommit: (draft) => save({ vertexModel: draft }),
    });

    return (
        <SettingCard
            title={t('cardVertexGeminiTitle')}
            description={t('cardVertexGeminiEphemeralDesc')}
        >
            <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                hidden
                aria-label="Upload service account JSON"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                        check.importKeyFile(file);
                    }
                    event.target.value = '';
                }}
            />

            <div className="setting">
                <span className="setting-label">
                    {t('vertexServiceAccountLabel')}
                </span>
                <div>
                    <FileButton
                        onClick={() => fileInput.current?.click()}
                        loading={check.importing}
                    >
                        {check.importing
                            ? t('vertexImporting')
                            : t('vertexImportButton')}
                    </FileButton>
                    <TestResultDisplay result={check.importResult} />
                </div>
            </div>

            <div className="setting">
                <label htmlFor="vertexAccessToken">
                    {t('vertexAccessTokenLabel')}
                </label>
                <input
                    type="password"
                    id="vertexAccessToken"
                    autoComplete="off"
                    placeholder="ya29...."
                    value={settings.vertexAccessToken}
                    onChange={(event) =>
                        void save({
                            vertexAccessToken: event.target.value,
                            vertexTokenExpiresAt: 0,
                        })
                    }
                />
            </div>

            <div className="setting">
                <label htmlFor="vertexProjectId">
                    {t('vertexProjectIdLabel')}
                </label>
                <div>
                    <input
                        type="text"
                        id="vertexProjectId"
                        placeholder="your-gcp-project-id"
                        value={projectIdField.value}
                        aria-invalid={projectIdField.invalid}
                        aria-describedby={
                            projectIdField.invalid
                                ? 'vertexProjectIdError'
                                : undefined
                        }
                        onChange={(event) =>
                            projectIdField.change(event.target.value)
                        }
                        onBlur={() => void projectIdField.commit()}
                        onKeyDown={projectIdField.handleKeyDown}
                    />
                    <FieldError
                        id="vertexProjectIdError"
                        visible={projectIdField.invalid}
                        t={t}
                    />
                </div>
            </div>

            <div className="setting">
                <label htmlFor="vertexLocation">
                    {t('vertexLocationLabel')}
                </label>
                <select
                    id="vertexLocation"
                    value={settings.vertexLocation}
                    onChange={(event) => {
                        if (isVertexLocation(event.target.value)) {
                            void save({ vertexLocation: event.target.value });
                        }
                    }}
                >
                    {VERTEX_LOCATIONS.map((region) => (
                        <option key={region} value={region}>
                            {region}
                        </option>
                    ))}
                </select>
            </div>

            <div className="setting">
                <label htmlFor="vertexModel">{t('vertexModelLabel')}</label>
                <div>
                    <input
                        type="text"
                        id="vertexModel"
                        placeholder="gemini-2.5-flash"
                        value={modelField.value}
                        aria-invalid={modelField.invalid}
                        aria-describedby={
                            modelField.invalid ? 'vertexModelError' : undefined
                        }
                        onChange={(event) =>
                            modelField.change(event.target.value)
                        }
                        onBlur={() => void modelField.commit()}
                        onKeyDown={modelField.handleKeyDown}
                    />
                    <FieldError
                        id="vertexModelError"
                        visible={modelField.invalid}
                        t={t}
                    />
                </div>
            </div>

            <div className="setting test-setting">
                <TestResultDisplay result={check.result} />
                <SparkleButton
                    onClick={check.test}
                    disabled={
                        check.testing ||
                        !settings.vertexAccessToken ||
                        !settings.vertexProjectId
                    }
                >
                    {check.testing
                        ? t('testingButton')
                        : t('testConnectionButton')}
                </SparkleButton>
            </div>

            <div className="provider-info">
                <div className="info-item">
                    <strong>{t('providerFeatures')}</strong>
                    <ul>
                        <li>{t('featureVertexServiceAccount')}</li>
                        <li>{t('featureVertexEphemeralToken')}</li>
                        <li>{t('featureVertexGemini')}</li>
                        <li>{t('featureWideLanguageSupport')}</li>
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}
