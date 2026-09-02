export function StatusMessage({ message }: { message: string }) {
    return (
        <p
            id="statusMessage"
            role="status"
            aria-live="polite"
            aria-atomic="true"
        >
            {message}
        </p>
    );
}
