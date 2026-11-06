/** Marks a value one site keeps for itself, where a row has no room for the
 *  site's tag: a dot that names the site in its tooltip and to screen
 *  readers. */
export function SiteDot({ label }: { label: string }) {
    return (
        <span className="site-dot" title={label}>
            <span className="sr-only">{label}</span>
        </span>
    );
}
