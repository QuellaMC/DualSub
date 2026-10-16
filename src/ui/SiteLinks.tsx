import { PLATFORM_IDS, PLATFORM_NAMES, platformHome } from '@/shared/platforms';
import { Icon } from './design/Icon';
import type { Translate } from './hooks/useI18n';

/** A button for each site DualSub works on, opening it in a new tab. */
export function SiteLinks({
    t,
    className,
}: {
    t: Translate;
    className: string;
}) {
    return PLATFORM_IDS.map((site) => (
        <a
            key={site}
            className={className}
            href={platformHome(site)}
            target="_blank"
            rel="noopener noreferrer"
        >
            {t('startOpenSite', PLATFORM_NAMES[site])}
            <Icon name="external" />
        </a>
    ));
}
