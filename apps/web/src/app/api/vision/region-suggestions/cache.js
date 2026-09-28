"use strict";
// Bounded, owner-scoped reuse of a suggestion batch.
//
// The cache key is built from the owner, the image, the SHA-256 of the analysis
// proxy PIXELS, the hash of the mask PIXELS and every model/pipeline version, so
// an edited mask or a different encoder/head/preprocessing can never hit a stale
// entry. Entries are stored in memory with a small bound and a short TTL: this
// is a real, bounded reuse, not a key returned after inferring.
//
// A human decision is never stored here; only predictions are reused.
Object.defineProperty(exports, "__esModule", { value: true });
exports.readCachedBatch = readCachedBatch;
exports.writeCachedBatch = writeCachedBatch;
exports.clearSuggestionCache = clearSuggestionCache;
const MAX_ENTRIES = 32;
const TTL_MS = 10 * 60 * 1000;
const entries = new Map();
function readCachedBatch(key, ownerId) {
    const entry = entries.get(key);
    if (!entry)
        return null;
    if (entry.ownerId !== ownerId)
        return null;
    if (Date.now() - entry.storedAt > TTL_MS) {
        entries.delete(key);
        return null;
    }
    // Refresh recency.
    entries.delete(key);
    entries.set(key, entry);
    return entry.payload;
}
function writeCachedBatch(key, ownerId, payload) {
    entries.delete(key);
    entries.set(key, { ownerId, payload, storedAt: Date.now() });
    while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next();
        if (oldest.done)
            break;
        entries.delete(oldest.value);
    }
}
function clearSuggestionCache() {
    entries.clear();
}
