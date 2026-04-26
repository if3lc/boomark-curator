import { DEFAULT_SETTINGS } from "../shared/defaults";
import type { Settings } from "../shared/types";

const SETTINGS_KEY = "bookmark-curator-settings";

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
