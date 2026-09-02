import type { Translate } from '../hooks/useI18n';

/** Inline validation guidance for a committed text field. */
export function FieldError({
    id,
    visible,
    t,
}: {
    id: string;
    visible: boolean;
    t: Translate;
}) {
    if (!visible) {
        return null;
    }
    return (
        <span id={id} className="settings-field-error">
            {t('invalidSettingValue')}
        </span>
    );
}
