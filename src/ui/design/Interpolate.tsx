import type { ReactNode } from 'react';

/** A translation holding one `%s`, with `children` in its place: a link or
 *  a code name inside a sentence whose word order each language decides. */
export function Interpolate({
    text,
    children,
}: {
    text: string;
    children: ReactNode;
}) {
    const at = text.indexOf('%s');
    if (at === -1) {
        return text;
    }
    return (
        <>
            {text.slice(0, at)}
            {children}
            {text.slice(at + 2)}
        </>
    );
}
