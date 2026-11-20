// The desktop app's installer, served from deeparam.com/download/<os>. Each release (release.yml) attaches it
// under this fixed name, so the newest release always answers the same address. Windows only for now.
export const APP_DOWNLOADS = {
  windows: { file: "DeepARAM-Windows-Setup.exe", label: "Windows", type: "application/vnd.microsoft.portable-executable" },
} as const;

export type AppOs = keyof typeof APP_DOWNLOADS;

export const isAppOs = (v: string): v is AppOs => Object.prototype.hasOwnProperty.call(APP_DOWNLOADS, v);

/** Whether the browser runs on Windows, where the app installs. */
export const onWindows = (userAgent: string) => /windows/i.test(userAgent);
