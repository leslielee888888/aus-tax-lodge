/**
 * Client-safe half of the per-instance settings (PRD FR-18): the shape, the
 * bounds, the defaults, and the pure normaliser. No Node imports — the settings
 * screen's Client Component pulls the constants and type from here, while the
 * filesystem read/write lives in the server-only `instance-settings.ts`.
 */
export interface PurgeSourceDocumentsSetting {
  readonly enabled: boolean;
  /** Days after a return's export date before its source documents are purged. */
  readonly afterDays: number;
}

export interface InstanceSettings {
  readonly purgeSourceDocuments: PurgeSourceDocumentsSetting;
}

export const PURGE_MIN_DAYS = 7;
export const PURGE_MAX_DAYS = 3650;

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = {
  purgeSourceDocuments: { enabled: false, afterDays: 90 },
};

function clampDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_INSTANCE_SETTINGS.purgeSourceDocuments.afterDays;
  }
  return Math.min(PURGE_MAX_DAYS, Math.max(PURGE_MIN_DAYS, Math.round(value)));
}

/** Coerce arbitrary parsed JSON into a valid {@link InstanceSettings}, filling defaults. Never auto-enables. */
export function normalizeInstanceSettings(value: unknown): InstanceSettings {
  const root = (value ?? {}) as Record<string, unknown>;
  const purge = (root.purgeSourceDocuments ?? {}) as Record<string, unknown>;
  return {
    purgeSourceDocuments: {
      enabled: purge.enabled === true,
      afterDays: clampDays(purge.afterDays),
    },
  };
}
