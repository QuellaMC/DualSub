import { Icon } from '../../design/Icon';
import { Switch } from '../../design/Switch';
import type { Translate } from '../../hooks/useI18n';
import { SECTION_IDS, SECTIONS, type SectionId } from '../sections';

export function Nav({
    t,
    section,
    advanced,
    onSection,
    onAdvanced,
}: {
    t: Translate;
    section: SectionId;
    advanced: boolean;
    onSection: (section: SectionId) => void;
    onAdvanced: (advanced: boolean) => void;
}) {
    const visible = SECTION_IDS.filter(
        (id) => advanced || !SECTIONS[id].advanced
    );
    return (
        <nav className="nav" aria-label={t('navLabel')}>
            <ul>
                {visible.map((id) => (
                    <li key={id} className={id === 'help' ? 'nav-help' : ''}>
                        <a
                            href={`#${id}`}
                            aria-current={id === section ? 'page' : undefined}
                            onClick={(event) => {
                                event.preventDefault();
                                onSection(id);
                            }}
                        >
                            <Icon name={SECTIONS[id].icon} />
                            <span>{t(SECTIONS[id].labelKey)}</span>
                        </a>
                    </li>
                ))}
            </ul>
            <div className="advanced-switch">
                <div>
                    <div className="strong" id="advanced-label">
                        {t('navAdvancedSwitch')}
                    </div>
                    <div className="help">{t('navAdvancedSwitchHelp')}</div>
                </div>
                <Switch
                    checked={advanced}
                    labelledBy="advanced-label"
                    onChange={onAdvanced}
                />
            </div>
        </nav>
    );
}
