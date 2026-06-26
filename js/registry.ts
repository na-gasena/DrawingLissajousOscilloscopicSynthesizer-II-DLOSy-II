/**
 * DLOSy20 - Serializable registry
 *
 * Modules implement `Serializable` and register themselves here. PresetManager
 * collects/applies state by iterating the registry, so it no longer imports each
 * feature module directly — this breaks the preset-manager ⇄ module import
 * cycles. Dependencies now point one way: feature modules → registry.
 */
export interface Serializable {
  /** Stable key used in the saved preset JSON (e.g. 'sequencer'). */
  readonly stateKey: string;
  getState(): unknown;
  setState(state: unknown): void;
}

const registry: Serializable[] = [];

export function registerSerializable(module: Serializable): void {
  if (registry.some(m => m.stateKey === module.stateKey)) return;
  registry.push(module);
}

/** Gather every registered module's state, keyed by its stateKey. */
export function collectState(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of registry) {
    try {
      out[m.stateKey] = m.getState();
    } catch (e) {
      console.warn(`collectState failed for "${m.stateKey}"`, e);
    }
  }
  return out;
}

/** Apply a previously collected state to every registered module. */
export function applyState(state: Record<string, unknown>): void {
  for (const m of registry) {
    const slice = state[m.stateKey];
    if (slice === undefined || slice === null) continue;
    try {
      m.setState(slice);
    } catch (e) {
      console.warn(`setState failed for "${m.stateKey}"`, e);
    }
  }
}
