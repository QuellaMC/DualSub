import { segmentWords } from '../selection/words';

export interface WordIntent {
    readonly renderRevision: number;
    readonly wordIndex: number;
    readonly word: string;
}

function paint(span: HTMLSpanElement, color: string | null): void {
    span.style.backgroundColor = color ?? '';
    span.style.boxShadow = color ? `${HIGHLIGHT_SPREAD} ${color}` : '';
}

interface WordRegistry {
    readonly renderRevision: number;
    readonly spans: readonly HTMLSpanElement[];
}

const HOVER_BACKGROUND = 'rgba(255, 255, 255, 0.22)';
const SELECTED_BACKGROUND = 'rgba(19, 127, 236, 0.65)';
/** The highlight reaches past the glyphs through a shadow spread rather than
 *  padding, so a clickable line keeps the spacing of a plain one. */
const HIGHLIGHT_SPREAD = '0 0 0 2px';

/**
 * Paints the original subtitle line as clickable words and turns clicks
 * into intents against the revision that painted them. Highlight state is
 * applied here only on instruction: the selection authority decides what
 * is selected, this layer only shows it.
 */
export class WordLayer {
    private registry: WordRegistry | null = null;
    private selected: ReadonlySet<number> = new Set();
    private bound: { element: HTMLElement; scope: AbortController } | null =
        null;

    constructor(
        private readonly deps: {
            readonly language: () => string;
            readonly onIntent: (intent: WordIntent) => void;
        }
    ) {}

    /** Replace the element's content with one span per word. */
    paint(element: HTMLElement, text: string, renderRevision: number): void {
        this.bind(element);
        const fragment = document.createDocumentFragment();
        const spans: HTMLSpanElement[] = [];
        let cursor = 0;
        for (const { word, start, end } of segmentWords(
            text,
            this.deps.language()
        )) {
            if (start > cursor) {
                fragment.append(text.slice(cursor, start));
            }
            const span = document.createElement('span');
            span.textContent = word;
            span.dataset.wordIndex = String(spans.length);
            span.setAttribute('role', 'button');
            span.setAttribute('tabindex', '0');
            span.setAttribute('aria-pressed', 'false');
            Object.assign(span.style, {
                cursor: 'pointer',
                borderRadius: '3px',
                transition:
                    'background-color 0.15s ease, box-shadow 0.15s ease',
            });
            fragment.append(span);
            spans.push(span);
            cursor = end;
        }
        if (cursor < text.length) {
            fragment.append(text.slice(cursor));
        }
        element.replaceChildren(fragment);
        this.registry = { renderRevision, spans };
        this.selected = new Set();
    }

    /** The current line is plain text again; nothing is clickable. */
    forget(): void {
        this.registry = null;
        this.selected = new Set();
    }

    setSelected(indices: Iterable<number>): void {
        this.selected = new Set(indices);
        const spans = this.registry?.spans ?? [];
        spans.forEach((span, index) => {
            const selected = this.selected.has(index);
            span.setAttribute('aria-pressed', String(selected));
            paint(span, selected ? SELECTED_BACKGROUND : null);
        });
    }

    destroy(): void {
        this.bound?.scope.abort();
        this.bound = null;
        this.forget();
    }

    private bind(element: HTMLElement): void {
        if (this.bound?.element === element) {
            return;
        }
        this.bound?.scope.abort();
        const scope = new AbortController();
        const { signal } = scope;
        element.addEventListener(
            'click',
            (event) => this.activate(event, event.target),
            { signal }
        );
        element.addEventListener(
            'keydown',
            (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    this.activate(event, event.target);
                }
            },
            { signal }
        );
        element.addEventListener(
            'mouseover',
            (event) => this.hover(event.target, true),
            { signal }
        );
        element.addEventListener(
            'mouseout',
            (event) => this.hover(event.target, false),
            { signal }
        );
        this.bound = { element, scope };
    }

    private activate(event: Event, target: EventTarget | null): void {
        const resolved = this.resolve(target);
        if (!resolved) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.deps.onIntent(resolved);
    }

    private hover(target: EventTarget | null, entering: boolean): void {
        const resolved = this.resolve(target);
        if (!resolved || this.selected.has(resolved.wordIndex)) {
            return;
        }
        paint(
            this.registry!.spans[resolved.wordIndex]!,
            entering ? HOVER_BACKGROUND : null
        );
    }

    /** A span is only an intent while it is the registered span at its
     *  index for the revision that painted it. */
    private resolve(target: EventTarget | null): WordIntent | null {
        const registry = this.registry;
        if (!registry || !(target instanceof HTMLElement)) {
            return null;
        }
        const index = Number(target.dataset.wordIndex);
        const span = Number.isInteger(index)
            ? registry.spans[index]
            : undefined;
        if (!span || span !== target || !span.isConnected) {
            return null;
        }
        return {
            renderRevision: registry.renderRevision,
            wordIndex: index,
            word: span.textContent ?? '',
        };
    }
}
