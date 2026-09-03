export interface DisplaySettings {
    readonly fontSizeVw: number;
    readonly gap: number;
    readonly verticalPosition: number;
    readonly orientation: 'column' | 'row';
    readonly order: 'original_top' | 'translation_top';
    readonly timeOffset: number;
}

export interface SubtitleElements {
    readonly container: HTMLDivElement;
    readonly original: HTMLDivElement;
    readonly translated: HTMLDivElement;
}

export function createSubtitleElements(): SubtitleElements {
    const container = document.createElement('div');
    container.id = 'dualsub-subtitle-container';
    Object.assign(container.style, {
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '9999',
        pointerEvents: 'none',
        width: '94%',
        maxWidth: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
    });

    const original = document.createElement('div');
    original.id = 'dualsub-original-subtitle';
    Object.assign(original.style, {
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        textShadow: '1px 1px 2px black, 0 0 3px black',
        borderRadius: '4px',
    });

    const translated = document.createElement('div');
    translated.id = 'dualsub-translated-subtitle';
    Object.assign(translated.style, {
        color: '#00FFFF',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        textShadow: '1px 1px 2px black, 0 0 3px black',
        borderRadius: '4px',
    });

    container.append(original, translated);
    return { container, original, translated };
}

/** A slot is drawn only when it has text: its padding and background
 *  would otherwise sit over the video as an empty box. */
export function applySlotVisibility(elements: SubtitleElements): void {
    for (const slot of [elements.original, elements.translated]) {
        slot.style.display = slot.textContent === '' ? 'none' : 'inline-block';
    }
}

/** The user's 0.1–9.9 slider maps to a 5%–50% `bottom` offset. */
function verticalPositionToBottomPercent(verticalPosition: number): number {
    const clamped = Math.max(0.1, Math.min(9.9, verticalPosition));
    const normalized = (clamped - 0.1) / (9.9 - 0.1);
    return 5 + normalized * 45;
}

export function applyDisplaySettings(
    elements: SubtitleElements,
    display: DisplaySettings
): void {
    const { container, original, translated } = elements;

    for (const element of [original, translated]) {
        Object.assign(element.style, {
            padding: '0.2em 0.5em',
            lineHeight: '1.3',
            whiteSpace: 'pre-line',
            overflow: 'visible',
            textOverflow: 'clip',
            fontSize: `${display.fontSizeVw}vw`,
            width: 'auto',
            textAlign: 'center',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
            userSelect: 'text',
            cursor: 'default',
            zIndex: '10001',
        });
        element.style.setProperty('margin-top', '0', 'important');
    }

    Object.assign(container.style, {
        flexDirection: display.orientation,
        width: '94%',
        justifyContent: 'center',
        alignItems: 'center',
        bottom: `${verticalPositionToBottomPercent(display.verticalPosition)}%`,
    });

    const first = display.order === 'translation_top' ? translated : original;
    const second = display.order === 'translation_top' ? original : translated;
    container.replaceChildren(first, second);

    applySlotVisibility(elements);

    if (display.orientation === 'column') {
        first.style.maxWidth = '100%';
        second.style.maxWidth = '100%';
        first.style.setProperty(
            'margin-bottom',
            `${0.1 + display.gap}em`,
            'important'
        );
        second.style.setProperty('margin-bottom', '0', 'important');
        first.style.setProperty('margin-right', '0', 'important');
        second.style.setProperty('margin-right', '0', 'important');
    } else {
        first.style.maxWidth = 'calc(50% - 1%)';
        second.style.maxWidth = 'calc(50% - 1%)';
        first.style.verticalAlign = 'top';
        second.style.verticalAlign = 'top';
        first.style.setProperty('margin-bottom', '0', 'important');
        second.style.setProperty('margin-bottom', '0', 'important');
        first.style.setProperty(
            'margin-right',
            `${0.5 + display.gap}em`,
            'important'
        );
        second.style.setProperty('margin-right', '0', 'important');
    }
}
