/**
 * DLOSy20 - Minimal event bus
 *
 * Decouples "something happened" notifications from their handlers. A module can
 * emit an event (e.g. `emit('state:changed')`) without importing whoever listens
 * for it (e.g. PresetManager) — this removes the module → preset-manager back
 * edges that previously formed import cycles.
 */
type Handler = (payload?: unknown) => void;

const listeners = new Map<string, Set<Handler>>();

/** Subscribe to an event. Returns an unsubscribe function. */
export function on(event: string, handler: Handler): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler);
  return () => { set!.delete(handler); };
}

/** Fire an event to all current subscribers. Handler errors are isolated. */
export function emit(event: string, payload?: unknown): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of set) {
    try {
      handler(payload);
    } catch (e) {
      console.warn(`event handler for "${event}" threw`, e);
    }
  }
}
