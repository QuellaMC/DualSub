(function() {
    const EVENT_ID = 'hulu-dualsub-injector-event';

    function dispatchEvent(detail) {
        try {
            document.dispatchEvent(
                new CustomEvent(EVENT_ID, { detail })
            );
        } catch (_) {
            // ignore
        }
    }

    // Notify ready
    dispatchEvent({ type: 'INJECT_SCRIPT_READY' });

    function extractTranscripts(json) {
        try {
            const videoId = json?.video_metadata?.asset_id || json?.video_metadata?.media_id || json?.content_eab_id || null;

            // transcripts_urls_v2 preferred
            const v2 = json?.transcripts_urls_v2 || {};
            const v1 = json?.transcripts_urls || {};

            const ttmlArr = Array.isArray(v2.ttml)
                ? v2.ttml.map((e) => ({ lang: e.lang || e.language || 'unknown', url: e.url, display_name: e.display_name || e.lang || '' }))
                : Object.entries(v1.ttml || {}).map(([lang, url]) => ({ lang, url, display_name: lang }));

            const vttArr = Array.isArray(v2.webvtt)
                ? v2.webvtt.map((e) => ({ lang: e.lang || e.language || 'unknown', url: e.url, display_name: e.display_name || e.lang || '' }))
                : Object.entries(v1.webvtt || {}).map(([lang, url]) => ({ lang, url, display_name: lang }));

            if ((ttmlArr.length > 0 || vttArr.length > 0) && videoId) {
                return { videoId, transcripts: { ttml: ttmlArr, webvtt: vttArr } };
            }
        } catch (e) {
            // ignore
        }
        return null;
    }

    async function parseResponseClone(response) {
        try {
            const clone = response.clone();
            const contentType = clone.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) return null;
            const data = await clone.json();
            return data;
        } catch (e) {
            return null;
        }
    }

    // Install a minimal fetch hook after page scripts run to reduce interference
    function installFetchHook() {
        try {
            const origFetch = window.fetch;
            const wrappedFetch = function(...args) {
                const p = origFetch.apply(this, args);
                try {
                    const url = (args && args[0] && args[0].url) || args[0] || '';
                    if (typeof url === 'string' && url.includes('play.hulu.com') && url.includes('/v6/playlist')) {
                        p.then(async (res) => {
                            const json = await parseResponseClone(res);
                            if (json) {
                                const extracted = extractTranscripts(json);
                                if (extracted) {
                                    dispatchEvent({ type: 'HULU_TRANSCRIPTS_FOUND', ...extracted });
                                }
                            }
                        }).catch(() => {});
                    }
                } catch (_) {}
                return p;
            };
            try { wrappedFetch.toString = function() { return origFetch.toString(); }; } catch (_) {}
            try { Object.setPrototypeOf(wrappedFetch, origFetch); } catch (_) {}
            window.fetch = wrappedFetch;
        } catch (_) {}
    }

    // Defer hook installation to avoid tripping feature detection during boot
    setTimeout(installFetchHook, 0);
})();
