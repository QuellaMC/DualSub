/** The streaming sites DualSub works on. */
export const PLATFORM_IDS = ['netflix', 'disneyplus'] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

/** Brand names, the same in every language. */
export const PLATFORM_NAMES: Record<PlatformId, string> = {
    netflix: 'Netflix',
    disneyplus: 'Disney+',
};

/** The domain each site lives on, subdomains included. */
export const PLATFORM_HOSTS: Record<PlatformId, string> = {
    netflix: 'netflix.com',
    disneyplus: 'disneyplus.com',
};

/** Where a viewer starts watching on the site. */
export function platformHome(id: PlatformId): string {
    return `https://www.${PLATFORM_HOSTS[id]}/`;
}

export function isPlatformId(value: unknown): value is PlatformId {
    return (PLATFORM_IDS as readonly unknown[]).includes(value);
}

/** The site an https URL belongs to, or null. */
export function platformFromUrl(url: string | undefined): PlatformId | null {
    if (!url) {
        return null;
    }
    let hostname: string;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') {
            return null;
        }
        hostname = parsed.hostname;
    } catch {
        return null;
    }
    return (
        PLATFORM_IDS.find(
            (id) =>
                hostname === PLATFORM_HOSTS[id] ||
                hostname.endsWith(`.${PLATFORM_HOSTS[id]}`)
        ) ?? null
    );
}
