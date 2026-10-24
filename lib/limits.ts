/**
 * Protocol limits enforced by the Envelope smart contract.
 */
export const MIN_DURATION = 3600n; // 1 hour
export const MAX_DURATION = 31536000n; // 365 days
export const MAX_NOTE_BYTES = 140;
export const MAX_SECRET_BYTES = 64;
export const MAX_PAGE = 50;

export const DURATION_PRESETS = [
  { label: "1 hour", value: 3600n },
  { label: "1 day", value: 86400n },
  { label: "1 week", value: 604800n },
  { label: "30 days", value: 2592000n },
  { label: "1 year", value: 31536000n },
] as const;
