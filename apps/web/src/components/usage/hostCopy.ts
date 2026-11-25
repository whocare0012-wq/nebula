// The cleanup center's copy names macOS places; a Windows host recycles instead of trashing.
const WINDOWS_COPY: Readonly<Record<string, string>> = {
  "Moved to Trash": "Moved to Recycle Bin",
  "Move to Trash · Space stays occupied": "Move to Recycle Bin · Space stays occupied",
  "Move to Trash · no immediate space released":
    "Move to Recycle Bin · no immediate space released",
  "Move to Trash (no immediate space released)":
    "Move to Recycle Bin (no immediate space released)",
  "No background timer or automatic deletion. Trash is retained until manually restored or emptied.":
    "No background timer or automatic deletion. The Recycle Bin keeps items until you restore or empty it.",
  "Bounded allowlist scan; protected data is never selected. Trash does not free disk space.":
    "Bounded allowlist scan; protected data is never selected. The Recycle Bin does not free disk space.",
  "Sizes are allocated space. Cloned files on APFS are counted in full, so totals can exceed what deleting would free.":
    "Sizes are allocated space. Shared or linked files can be counted more than once, so totals can exceed what deleting would free.",
};

export const hostCopy = (text: string, windows: boolean): string =>
  windows ? (WINDOWS_COPY[text] ?? text) : text;
