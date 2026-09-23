const TAB_ID_KEY = "syncspace-tab-id";
export function getTabId() {
  let id = sessionStorage.getItem(TAB_ID_KEY);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(TAB_ID_KEY, id); }
  return id;
}
export const AUTH_KEY = `syncspace-auth-${getTabId()}`;
export function getStoredAuth() { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; } }
export function makeRoomId() { return crypto.randomUUID().replaceAll("-", "").slice(0, 10); }
