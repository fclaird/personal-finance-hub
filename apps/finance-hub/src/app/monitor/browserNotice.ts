/** Ask this browser to show a local notification. Returns false when the API is missing or permission is denied. */
export async function enableBrowserNotices(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function postBrowserNotice(title: string, body: string): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  new Notification(title, { body });
  return true;
}
