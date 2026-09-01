// happy-dom exposes navigation control on window.happyDOM (untyped).
export function setUrl(url: string): void {
    (
        window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM.setURL(url);
}
