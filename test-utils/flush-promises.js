// Lightweight local replacement for the 'flush-promises' package
// Ensures all pending microtasks are processed before continuing
export default function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
