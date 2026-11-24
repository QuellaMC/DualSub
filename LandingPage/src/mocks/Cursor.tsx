import './Cursor.css';

/** The arrow pointer, placed by the illustration that uses it. */
export function Cursor({ className }: { className: string }) {
    return (
        <svg
            className={`cursor ${className}`}
            viewBox="0 0 16 24"
            aria-hidden="true"
        >
            <path
                d="M1.5 1.5v18l4.5-4.2 2.9 6.5 3-1.3-2.9-6.4h6.2z"
                fill="#000"
                stroke="#fff"
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
        </svg>
    );
}
