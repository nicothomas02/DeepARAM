// The desktop app's installers, served from deeparam.com/download/<os>. Each release (release.yml) attaches them
// under these fixed names, so the newest release always answers the same address.
export const APP_DOWNLOADS = {
  windows: { file: "DeepARAM-Windows-Setup.exe", label: "Windows", type: "application/vnd.microsoft.portable-executable" },
  mac: { file: "DeepARAM-Mac.dmg", label: "Mac", type: "application/x-apple-diskimage" },
} as const;

export type AppOs = keyof typeof APP_DOWNLOADS;

export const isAppOs = (v: string): v is AppOs => Object.prototype.hasOwnProperty.call(APP_DOWNLOADS, v);

/** Which installer to suggest first, from the browser's user agent. */
export function guessOs(userAgent: string): AppOs | null {
  if (/iphone|ipad|android/i.test(userAgent)) return null;
  if (/mac os x|macintosh/i.test(userAgent)) return "mac";
  if (/windows/i.test(userAgent)) return "windows";
  return null;
}
