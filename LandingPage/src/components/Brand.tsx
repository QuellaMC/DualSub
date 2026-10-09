import './Brand.css';

const MARK_URL = `${import.meta.env.BASE_URL}icon128.png`;

/** The extension's own toolbar icon, so the site and the product share one mark. */
export function LogoMark({ className }: { className?: string }) {
    return (
        <img
            className={className}
            src={MARK_URL}
            alt=""
            width={128}
            height={128}
        />
    );
}

export function Wordmark() {
    return (
        <span className="wordmark">
            <LogoMark className="wordmark-mark" />
            <span className="wordmark-text">
                Dual<span className="wordmark-accent">Sub</span>
            </span>
        </span>
    );
}
