import './Settings.css';

const SECTIONS = [
    'General',
    'Translation',
    'Providers',
    'AI Context',
    'Advanced Settings',
    'About',
] as const;

/** The options page on its AI Context section, set up with an OpenAI key. */
export function SettingsMock() {
    return (
        <div className="settings">
            <div className="settings-sidebar">
                <strong className="settings-brand">DualSub</strong>
                {SECTIONS.map((section) => (
                    <span
                        key={section}
                        className={
                            section === 'AI Context'
                                ? 'settings-nav settings-nav-active'
                                : 'settings-nav'
                        }
                    >
                        {section}
                    </span>
                ))}
            </div>
            <div className="settings-content">
                <strong className="settings-title">AI Context Assistant</strong>
                <div className="settings-card">
                    <strong>Enable AI Context Analysis</strong>
                    <span className="settings-field">
                        Enable AI Context:
                        <span className="settings-switch" />
                    </span>
                </div>
                <div className="settings-card">
                    <strong>AI Provider</strong>
                    <span className="settings-field">
                        Provider:
                        <span className="settings-input settings-select">
                            OpenAI GPT
                        </span>
                    </span>
                </div>
                <div className="settings-card">
                    <strong>OpenAI Configuration</strong>
                    <span className="settings-field">
                        API Key:
                        <span className="settings-input settings-secret">
                            ••••••••••••••••
                        </span>
                    </span>
                    <span className="settings-field">
                        Model:
                        <span className="settings-input">gpt-5.6-luna</span>
                    </span>
                </div>
                <div className="settings-card">
                    <strong>Context Types</strong>
                    <span className="settings-field">
                        Cultural Context:
                        <span className="settings-switch" />
                    </span>
                </div>
            </div>
        </div>
    );
}
