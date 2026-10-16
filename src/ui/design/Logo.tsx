/** DualSub's mark: two subtitle lines, the video's above and yours below. */
export function Logo({ size }: { size: number }) {
    return (
        <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
            <rect x="1" y="3" width="19" height="14" rx="4" fill="#f2a516" />
            <path d="M5 16v6l6-5z" fill="#f2a516" />
            <rect x="12" y="11" width="19" height="14" rx="4" fill="#1f5ed6" />
            <path d="M27 24v6l-6-5z" fill="#1f5ed6" />
            <path
                d="M16 16h10M16 20h7"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </svg>
    );
}
