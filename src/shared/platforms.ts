/** The streaming sites DualSub works on. */
export const PLATFORM_IDS = ['netflix', 'disneyplus', 'youtube'] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

/** Brand names, the same in every language. */
export const PLATFORM_NAMES: Record<PlatformId, string> = {
    netflix: 'Netflix',
    disneyplus: 'Disney+',
    youtube: 'YouTube',
};

/** The domain each site lives on. */
export const PLATFORM_HOSTS: Record<PlatformId, string> = {
    netflix: 'netflix.com',
    disneyplus: 'disneyplus.com',
    youtube: 'youtube.com',
};

/** The hosts on that domain DualSub works on: all of them, or only these
 *  subdomains. YouTube's other hosts (m., music.) run other players. */
const PLATFORM_SUBDOMAINS: Record<PlatformId, 'all' | readonly string[]> = {
    netflix: 'all',
    disneyplus: 'all',
    youtube: ['www'],
};

/** Where a viewer starts watching on the site. */
export function platformHome(id: PlatformId): string {
    return `https://www.${PLATFORM_HOSTS[id]}/`;
}

export function isPlatformId(value: unknown): value is PlatformId {
    return (PLATFORM_IDS as readonly unknown[]).includes(value);
}

/** The site a hostname belongs to, or null. */
export function platformFromHostname(hostname: string): PlatformId | null {
    return (
        PLATFORM_IDS.find((id) => {
            const domain = PLATFORM_HOSTS[id];
            const subdomains = PLATFORM_SUBDOMAINS[id];
            return subdomains === 'all'
                ? hostname === domain || hostname.endsWith(`.${domain}`)
                : subdomains.some(
                      (subdomain) => hostname === `${subdomain}.${domain}`
                  );
        }) ?? null
    );
}

/** The site an https URL belongs to, or null. */
export function platformFromUrl(url: string | undefined): PlatformId | null {
    if (!url) {
        return null;
    }
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:'
            ? platformFromHostname(parsed.hostname)
            : null;
    } catch {
        return null;
    }
}
