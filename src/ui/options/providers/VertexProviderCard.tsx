import { useRef } from 'react';
import { validateSetting } from '@/config/schema';
import { VERTEX_LOCATIONS, type VertexLocation } from '@/shared/providers';
import type { Translate } from '../../hooks/useI18n';
import { useCommittedTextField } from '../../hooks/useCommittedTextField';
import { CommittedField } from '../controls/CommittedField';
import { useVertexCheck } from '../hooks/useVertexCheck';
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
        onCommit: (draft) => save({ vertexProjectId: draft }, 'quiet'),
    });
    const modelField = useCommittedTextField({
        value: settings.vertexModel,
        validate: (draft) => validateSetting('vertexModel', draft),
        onCommit: (draft) => save({ vertexModel: draft }, 'quiet'),
    });

    return (
        <div className="card" id="vertex-card" aria-labelledby="vertex-setup">
            <h2 className="label" id="vertex-setup">
                {t('translationVertexSetupTitle')}
            </h2>
            <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                hidden
                aria-label={t('vertexServiceAccountLabel')}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                        check.importKeyFile(file);
                    }
                    event.target.value = '';
                }}
            />
            <div className="row">
                <div className="grow">
                    <div className="strong">
                        {t('vertexServiceAccountLabel')}
                    </div>
                    <p className="help">{t('translationVertexHelp')}</p>
                    <TestResultDisplay result={check.importResult} />
                </div>
                <button
                    type="button"
                    className="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={check.importing}
                    aria-busy={check.importing}
                >
                    {check.importing
                        ? t('vertexImporting')
                        : t('vertexImportButton')}
                </button>
            </div>
            <div className="controls-grid">
                <div className="control">
                    <label htmlFor="vertexAccessToken">
                        {t('vertexAccessTokenLabel')}
                    </label>
                    <input
                        type="password"
                        id="vertexAccessToken"
                        className="field wide"
                        autoComplete="off"
                        placeholder="ya29...."
                        value={settings.vertexAccessToken}
                        onChange={(event) =>
                            void save(
                                {
                                    vertexAccessToken: event.target.value,
                                    vertexTokenExpiresAt: 0,
                                },
                                'quiet'
                            )
                        }
                    />
                </div>
                <div className="control">
                    <label htmlFor="vertexProjectId">
                        {t('vertexProjectIdLabel')}
                    </label>
                    <CommittedField
                        t={t}
                        id="vertexProjectId"
                        field={projectIdField}
                        className="wide mono"
                        placeholder="your-gcp-project-id"
                    />
                </div>
                <div className="control">
                    <label htmlFor="vertexLocation">
                        {t('vertexLocationLabel')}
                    </label>
                    <select
                        id="vertexLocation"
                        className="field wide"
                        value={settings.vertexLocation}
                        onChange={(event) => {
                            if (isVertexLocation(event.target.value)) {
                                void save(
                                    { vertexLocation: event.target.value },
                                    'quiet'
                                );
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
                <div className="control">
                    <label htmlFor="vertexModel">{t('vertexModelLabel')}</label>
                    <CommittedField
                        t={t}
                        id="vertexModel"
                        field={modelField}
                        className="wide mono"
                        placeholder="gemini-2.5-flash"
                    />
                </div>
            </div>
            <div className="row">
                <TestResultDisplay result={check.result} />
                <button
                    type="button"
                    className="button primary"
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
                </button>
            </div>
        </div>
    );
}
