// Milestone-0 spike (plan risk 1): proves a declarative MAIN-world content
// script patches JSON.parse before the host page's first parse. Replaced by
// interceptor-core when the real bridge lands.
export function installSpikeProbe(platform: 'netflix' | 'disneyplus'): void {
    const tag = `[DualSub:${platform}:main]`;
    const nativeParse = JSON.parse;
    let sawFirstParse = false;

    console.debug(
        `${tag} interceptor installed`,
        `readyState=${document.readyState}`,
        `headChildren=${document.head?.childElementCount ?? 'no-head'}`
    );

    JSON.parse = function (
        text: string,
        reviver?: (this: unknown, key: string, value: unknown) => unknown
    ) {
        if (!sawFirstParse) {
            sawFirstParse = true;
            console.debug(
                `${tag} first page JSON.parse observed`,
                `readyState=${document.readyState}`
            );
        }
        const result: unknown = nativeParse.call(JSON, text, reviver);
        return result;
    } as typeof JSON.parse;
}
