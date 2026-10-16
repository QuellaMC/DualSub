import type { InputHTMLAttributes } from 'react';
import type { CommittedTextField } from '../../hooks/useCommittedTextField';
import type { Translate } from '../../hooks/useI18n';

/** A text field that saves on blur or Enter and explains an invalid
 *  value. */
export function CommittedField({
    t,
    id,
    field,
    ...input
}: {
    t: Translate;
    id: string;
    field: CommittedTextField<string>;
} & Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'id' | 'value' | 'onChange' | 'onBlur' | 'onKeyDown'
>) {
    return (
        <>
            <input
                {...input}
                id={id}
                className={`field ${input.className ?? ''}`}
                value={field.value}
                aria-invalid={field.invalid}
                aria-describedby={field.invalid ? `${id}-error` : undefined}
                onChange={(event) => field.change(event.target.value)}
                onBlur={() => void field.commit()}
                onKeyDown={field.handleKeyDown}
            />
            {field.invalid && (
                <span id={`${id}-error`} className="status-line error">
                    {t('invalidSettingValue')}
                </span>
            )}
        </>
    );
}
