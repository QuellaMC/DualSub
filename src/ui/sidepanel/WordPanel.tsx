import { useState } from 'react';
import { AI_SERVICES } from '../AiKeySteps';
import { Icon } from '../design/Icon';
import { Logo } from '../design/Logo';
import type { Translate } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { languageName } from '../languageLabels';
import { openSettings } from '../openSettings';
import { SiteLinks } from '../SiteLinks';
import { ExplanationView } from './ExplanationView';
import { KeyGuide } from './KeyGuide';
import { LineQuote } from './LineQuote';
import { LookupCard, Placeholder } from './LookupCard';
import { ANALYSIS_SETTINGS_KEYS, useAnalysis } from './useAnalysis';
import { useLookup } from './useLookup';
import {
    sameWords,
    selectionWords,
    usePanelConnection,
} from './usePanelConnection';
import { useTabSite } from './useTabSite';

function Empty({ t }: { t: Translate }) {
    return (
        <section className="card">
            <div className="sample" aria-hidden="true">
                <span className="sample-line" lang="es">
                    Está lloviendo a{' '}
                    <mark>
                        cántaros
                        <svg className="sample-cursor" viewBox="0 0 24 24">
                            <path d="M5 3l13 6.5-5.6 1.9L10.6 17z" />
                        </svg>
                    </mark>
                </span>
            </div>
            <h2 className="title">{t('sidepanelEmptyTitle')}</h2>
            <p className="help">{t('sidepanelEmptyHelp')}</p>
        </section>
    );
}

function Elsewhere({ t }: { t: Translate }) {
    return (
        <section className="card">
            <h2 className="title">{t('sidepanelElsewhereTitle')}</h2>
            <p className="help">{t('sidepanelElsewhereHelp')}</p>
            <SiteLinks t={t} className="button big" />
        </section>
    );
}

/**
 * The word panel for the bound tab: the line the viewer picked words in,
 * what those words are, and an AI explanation when asked for. Content
 * owns the pick; the panel shows it and asks for words to be added or
 * taken out.
 */
export function WordPanel({ t }: { t: Translate }) {
    const panel = usePanelConnection();
    const { settings, status, save } = useSettings(ANALYSIS_SETTINGS_KEYS);
    const site = useTabSite(panel.activeTabId);
    useLookup(panel, settings?.targetLanguage ?? null);
    const ai = useAnalysis(panel, settings, status);
    const [editing, setEditing] = useState(false);

    const { selection, lookup } = panel.tab;
    const liveLine = selection?.line ?? null;
    // Away from a video the panel shows no line, even one a lookup kept.
    const line = site === null ? null : (liveLine ?? lookup?.line ?? null);
    const entries = liveLine ? selection!.entries : (lookup?.entries ?? []);
    // A lookup kept while no words are picked comes back with its words.
    const shownLookup =
        lookup &&
        (!liveLine ||
            sameWords(
                selectionWords(selection),
                lookup.entries.map((entry) => entry.word)
            ))
            ? lookup
            : null;
    const target = settings?.targetLanguage ?? null;
    const pair =
        line?.language && target
            ? t(
                  'sidepanelLanguagePair',
                  languageName(t, line.language),
                  languageName(t, target)
              )
            : null;

    const toggle =
        selection && liveLine && panel.validated && !editing
            ? (wordIndex: number, picked: boolean) => {
                  setEditing(true);
                  void panel
                      .requestEdit(
                          selection,
                          wordIndex,
                          picked ? 'remove' : 'add'
                      )
                      .finally(() => setEditing(false));
              }
            : null;

    const service = settings?.aiContextProvider ?? 'gemini';
    const { explanation, explaining } = ai;
    const aiPart = explaining ? (
        <div className="ai">
            <span className="sr-only" role="status">
                {t('sidepanelExplaining')}
            </span>
            <Placeholder widths={[36, 94, 86, 62]} />
        </div>
    ) : explanation?.answer && shownLookup ? (
        <ExplanationView
            t={t}
            answer={explanation.answer}
            words={shownLookup.text}
            language={shownLookup.line.language ?? undefined}
            service={t(AI_SERVICES[service].nameKey)}
        />
    ) : explanation?.failure === 'setup' || explanation?.failure === 'auth' ? (
        <KeyGuide
            t={t}
            service={service}
            openaiBaseUrl={settings?.openaiBaseUrl ?? ''}
            refused={explanation.failure === 'auth'}
            busy={explaining}
            onService={(id) => void save({ aiContextProvider: id })}
            onExplain={() => void ai.explain()}
            onDismiss={ai.dismiss}
        />
    ) : explanation?.failure === 'failed' ? (
        <div className="ai">
            <div className="ai-error" role="alert">
                <p>{t('sidepanelAiFailed')}</p>
                <button
                    type="button"
                    className="button"
                    onClick={() => void ai.explain()}
                >
                    {t('sidepanelTryAgain')}
                </button>
            </div>
        </div>
    ) : (
        <button
            type="button"
            className="button explain"
            disabled={status !== 'ready' || !panel.validated}
            onClick={() => void ai.explain()}
        >
            {t('explainWithAi')}
        </button>
    );

    return (
        <div className="panel">
            <header className="panel-head">
                <div className="brand">
                    <Logo size={28} />
                    <span>DualSub</span>
                </div>
                {pair && <span className="pair">{pair}</span>}
            </header>
            <main className="panel-body">
                {site === null ? (
                    <Elsewhere t={t} />
                ) : line === null ? (
                    <Empty t={t} />
                ) : (
                    <>
                        <LineQuote
                            t={t}
                            line={line}
                            entries={entries}
                            onToggle={toggle}
                        />
                        {shownLookup && (
                            <LookupCard
                                t={t}
                                lookup={shownLookup}
                                register={explanation?.answer?.register ?? null}
                            >
                                {aiPart}
                            </LookupCard>
                        )}
                    </>
                )}
            </main>
            <footer className="panel-foot">
                <button
                    type="button"
                    className="icon-button"
                    aria-label={t('navHelp')}
                    title={t('navHelp')}
                    onClick={() => openSettings('help')}
                >
                    <Icon name="help" />
                </button>
                <button
                    type="button"
                    className="icon-button"
                    aria-label={t('topSettings')}
                    title={t('topSettings')}
                    onClick={() => openSettings('explanations')}
                >
                    <Icon name="settings" />
                </button>
            </footer>
        </div>
    );
}
