import { CHROME_WEB_STORE_URL } from '../site';
import { Icon } from './Icon';

export function AddToChrome({ compact = false }: { compact?: boolean }) {
    return (
        <a
            className={
                compact
                    ? 'button button-primary button-compact'
                    : 'button button-primary'
            }
            href={CHROME_WEB_STORE_URL}
        >
            <Icon name="plus" />
            {compact ? 'Add to Chrome' : 'Add to Chrome — it’s free'}
        </a>
    );
}
