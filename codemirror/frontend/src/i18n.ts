// UI language follows the browser; entity IDs remain canonical HA identifiers.
export const korean = navigator.language.toLowerCase().startsWith('ko');
export const text = (en: string, ko: string): string => korean ? ko : en;
