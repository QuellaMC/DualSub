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
     * @param {Object|null} _position - Reserved for positional removal
     * @param {string|null} positionKey
     * @returns {boolean} True if any removal happened
     */
    remove(word, _position = null, positionKey = null) {
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
     * Remove duplicate representations of the same subtitle occurrence,
     * preferring 'original' subtitle and entries that have an element reference,
     * otherwise keeping the first inserted record.
     * @returns {number} Count of removed duplicates
     */
    removeDuplicatesPreferOriginal() {
        const toRemove = [];
        for (const group of this._getOccurrenceGroups()) {
            if (group.records.length <= 1) continue;
            const keep = this._selectPreferredOccurrenceRecord(group.records);
            group.records.forEach((p) => {
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
     * Get canonical occurrence entries without exposing internal position records.
     * @returns {{wordIndex: number, word: string}[]}
     */
    getOrderedEntries() {
        return this._getOccurrenceGroups()
            .filter((group) => group.occurrenceIndex !== null)
            .map((group) => {
                const preferred = this._selectPreferredOccurrenceRecord(
                    group.records
                );
                return {
                    wordIndex: group.occurrenceIndex,
                    word: preferred.entry.word,
                };
            });
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
        return this._getOrderedRecords().map(({ key }) => key);
    }

    /**
     * Return a valid occurrence index, preferring wordIndex when present.
     * @param {Object|undefined|null} position
     * @returns {number|null}
     * @private
     */
    _getOccurrenceIndex(position) {
        const value =
            position?.wordIndex !== undefined
                ? position.wordIndex
                : position?.index;
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }

    /**
     * Return current records in canonical occurrence order.
     * @returns {{key: string, entry: {word: string, position: Object}, occurrenceIndex: number|null, insertionIndex: number}[]}
     * @private
     */
    _getOrderedRecords() {
        return this.positionKeyOrder
            .map((key, insertionIndex) => ({
                key,
                entry: this.positionKeyToEntry.get(key),
                occurrenceIndex: this._getOccurrenceIndex(
                    this.positionKeyToEntry.get(key)?.position
                ),
                insertionIndex,
            }))
            .filter(({ entry }) => entry !== undefined)
            .sort((a, b) => {
                if (a.occurrenceIndex === null) {
                    return b.occurrenceIndex === null
                        ? a.insertionIndex - b.insertionIndex
                        : 1;
                }
                if (b.occurrenceIndex === null) return -1;
                return (
                    a.occurrenceIndex - b.occurrenceIndex ||
                    a.insertionIndex - b.insertionIndex
                );
            });
    }

    /**
     * Group only records that represent the same valid occurrence index.
     * Invalid-index records remain singleton groups identified by their exact key.
     * @returns {{occurrenceIndex: number|null, records: Object[]}[]}
     * @private
     */
    _getOccurrenceGroups() {
        const groups = [];
        const indexedGroups = new Map();

        for (const record of this._getOrderedRecords()) {
            if (record.occurrenceIndex === null) {
                groups.push({
                    occurrenceIndex: null,
                    records: [record],
                });
                continue;
            }

            let group = indexedGroups.get(record.occurrenceIndex);
            if (!group) {
                group = {
                    occurrenceIndex: record.occurrenceIndex,
                    records: [],
                };
                indexedGroups.set(record.occurrenceIndex, group);
                groups.push(group);
            }
            group.records.push(record);
        }

        return groups;
    }

    /**
     * Pick one representative using the model's established preference order.
     * @param {Object[]} records
     * @returns {Object}
     * @private
     */
    _selectPreferredOccurrenceRecord(records) {
        const withElement = records.filter(
            ({ entry }) => entry.position && entry.position.element
        );
        const withElementOriginal = withElement.filter(
            ({ entry }) =>
                (entry.position.subtitleType || '').toLowerCase() === 'original'
        );
        return withElementOriginal[0] || withElement[0] || records[0];
    }
}
