import { migrate, type GameState } from '../core/state';

const SAVE_KEY = 'happyfarm:save:v1';
const SETTINGS_KEY = 'happyfarm:settings';

export interface Settings {
  /** Ajuste manual de zoom somado ao zoom automático. */
  zoom: number;
  /** Ignora o relógio real e deixa sempre de dia. */
  alwaysDay: boolean;
  seenHelp: boolean;
}

const DEFAULT_SETTINGS: Settings = { zoom: 0, alwaysDay: false, seenHelp: false };

export function saveGame(state: GameState) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // storage cheio/bloqueado: o jogo continua, só não persiste
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw), Date.now());
  } catch {
    return null;
  }
}

export function clearGame() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
