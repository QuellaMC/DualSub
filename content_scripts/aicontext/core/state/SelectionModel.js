/**
 * SelectionModel - Pure selection state and operations
 *
 * Encapsulates position-based word selection without any DOM access.
 * Responsible for add/remove/toggle by position key, computing ordered text,
 * and deduplication rules. Consumers must provide deterministic position keys.
 */

export class SelectionModel {
    constructor() {
        // Map of positionKey -> { word, position }
        this.positionKeyToEntry = new Map();
        // Ordered array of position keys, representing user selection sequence
        this.positionKeyOrder = [];
        // Cache of selected text (derived)
        this.selectedText = '';
    }

    /**
     * Determine if a specific position key is selected
     * @param {string} positionKey
     * @returns {boolean}
     */
    has(positionKey) {
        return this.positionKeyToEntry.has(positionKey);
    }

    /**
     * Add a word selection at a specific position
     * @param {string} word
     * @param {Object} position
     * @param {string} positionKey
     * @returns {boolean} True if added
     */
    add(word, position, positionKey) {
        if (!positionKey || this.positionKeyToEntry.has(positionKey)) {
            return false;
        }

        this.positionKeyToEntry.set(positionKey, { word, position });
        this.positionKeyOrder.push(positionKey);
        this._updateSelectedTextInternal();
        return true;
    }

    /**
     * Remove a selection. If positionKey provided, remove that entry only.
     * Otherwise, remove all occurrences of the word.
     * @param {string} word
     * @param {Object|null} position
     * @param {string|null} positionKey
     * @returns {boolean} True if any removal happened
     */
    remove(word, position = null, positionKey = null) {
        let removed = false;

        if (positionKey) {
            if (this.positionKeyToEntry.has(positionKey)) {
                this.positionKeyToEntry.delete(positionKey);
                this.positionKeyOrder = this.positionKeyOrder.filter(
                    (k) => k !== positionKey
                );
                removed = true;
            }
        } else if (word) {
            const keysToRemove = [];
            for (const [key, entry] of this.positionKeyToEntry.entries()) {
                if (entry.word === word) {
                    keysToRemove.push(key);
                }
            }
            if (keysToRemove.length > 0) {
                keysToRemove.forEach((k) => this.positionKeyToEntry.delete(k));
                this.positionKeyOrder = this.positionKeyOrder.filter(
                    (k) => !keysToRemove.includes(k)
                );
                removed = true;
            }
        }

        if (removed) {
            this._updateSelectedTextInternal();
        }
        return removed;
    }

    /**
     * Toggle selection for a position key
     * @param {string} word
     * @param {Object} position
     * @param {string} positionKey
     * @returns {('added'|'removed'|'noop')}
     */
    toggle(word, position, positionKey) {
        if (!positionKey) return 'noop';
        if (this.positionKeyToEntry.has(positionKey)) {
            this.remove(word, position, positionKey);
            return 'removed';
        }
        this.add(word, position, positionKey);
        return 'added';
    }

    /**
     * Replace an existing position key with a new key and/or position
     * Used during restoration when DOM structure changes
     * @param {string} oldKey
     * @param {string} newKey
     * @param {string} word
     * @param {Object} newPosition
     */
    replacePositionKey(oldKey, newKey, word, newPosition) {
        if (!oldKey || !newKey) return;
        if (oldKey === newKey) return;
        if (this.positionKeyToEntry.has(oldKey)) {
            this.positionKeyToEntry.delete(oldKey);
            this.positionKeyToEntry.set(newKey, {
                word,
                position: newPosition,
            });
            const idx = this.positionKeyOrder.indexOf(oldKey);
            if (idx !== -1) this.positionKeyOrder[idx] = newKey;
            this._updateSelectedTextInternal();
        }
    }

    /**
     * Clear all selections
     */
    clear() {
        this.positionKeyToEntry.clear();
        this.positionKeyOrder = [];
        this.selectedText = '';
    }

    /**
     * Remove duplicate positions for the same word, preferring 'original' subtitle
     * and entries that have an element reference, otherwise keep first
     * @returns {number} Count of removed duplicates
     */
    removeDuplicatesPreferOriginal() {
        const wordToPositions = new Map();
        for (const [key, entry] of this.positionKeyToEntry.entries()) {
            const list = wordToPositions.get(entry.word) || [];
            list.push({ key, entry });
            wordToPositions.set(entry.word, list);
        }

        const toRemove = [];
        for (const [, list] of wordToPositions.entries()) {
            if (list.length <= 1) continue;
            const withElement = list.filter(
                (p) => p.entry.position && p.entry.position.element
            );
            const withElementOriginal = withElement.filter(
                (p) =>
                    (p.entry.position.subtitleType || '').toLowerCase() ===
                    'original'
            );
            let keep;
            if (withElementOriginal.length > 0) keep = withElementOriginal[0];
            else if (withElement.length > 0) keep = withElement[0];
            else keep = list[0];
            list.forEach((p) => {
                if (p.key !== keep.key) toRemove.push(p.key);
            });
        }

        if (toRemove.length > 0) {
            toRemove.forEach((k) => this.positionKeyToEntry.delete(k));
            this.positionKeyOrder = this.positionKeyOrder.filter(
                (k) => !toRemove.includes(k)
            );
            this._updateSelectedTextInternal();
        }
        return toRemove.length;
    }

    /**
     * Get a Set of selected words
     * @returns {Set<string>}
     */
    getSelectedWords() {
        const set = new Set();
        for (const [, entry] of this.positionKeyToEntry.entries()) {
            set.add(entry.word);
        }
        return set;
    }

    /**
     * Get ordered position keys (as currently stored)
     * @returns {string[]}
     */
    getPositionKeyOrder() {
        return [...this.positionKeyOrder];
    }

    /**
     * Get a shallow copy of the positions map
     * @returns {Map<string, {word: string, position: Object}>}
     */
    getPositionsMap() {
        return new Map(this.positionKeyToEntry);
    }

    /**
     * Recompute and return selected text using subtitle order
     * @returns {string}
     */
    updateSelectedText() {
        this._updateSelectedTextInternal();
        return this.selectedText;
    }

    /**
     * Internal: compute selected text from sorted positions
     * @private
     */
    _updateSelectedTextInternal() {
        const sortedKeys = this._computeSortedOrder();
        const words = sortedKeys
            .map((k) => this.positionKeyToEntry.get(k)?.word || '')
            .filter(Boolean);
        this.selectedText = words.join(' ');
    }

    /**
     * Sort position keys by their position.wordIndex or position.index
     * @returns {string[]}
     * @private
     */
    _computeSortedOrder() {
        const keys = [...this.positionKeyOrder];
        keys.sort((a, b) => {
            const pa = this.positionKeyToEntry.get(a)?.position || {};
            const pb = this.positionKeyToEntry.get(b)?.position || {};
            const ia =
                (pa.wordIndex !== undefined ? pa.wordIndex : pa.index) || 0;
            const ib =
                (pb.wordIndex !== undefined ? pb.wordIndex : pb.index) || 0;
            return ia - ib;
        });
        return keys;
    }
}
