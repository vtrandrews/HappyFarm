const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const PREVENT = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN, 'Space']);

/**
 * Alguns ambientes (acesso remoto/VDI, automação) mandam `code` vazio.
 * Nesse caso, deduz o código físico a partir de `key`.
 */
export function keyCode(e: KeyboardEvent): string {
  if (e.code) return e.code;
  const k = e.key;
  if (k === ' ') return 'Space';
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^\d$/.test(k)) return `Digit${k}`;
  if (k === '+' || k === '=') return 'Equal';
  if (k === '-') return 'Minus';
  return k; // Escape, Enter, ArrowUp, F1...
}

/** Teclado. Pode ser "religado" a outra janela (ex.: a janelinha do modo mini). */
export class Input {
  private keys = new Set<string>();
  private win: Window | null = null;
  onPress: (code: string, e: KeyboardEvent) => void = () => {};

  private kd = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const code = keyCode(e);
    if (PREVENT.has(code)) e.preventDefault();
    if (!e.repeat) this.onPress(code, e);
    this.keys.add(code);
  };
  private ku = (e: KeyboardEvent) => this.keys.delete(keyCode(e));
  private blur = () => this.keys.clear();

  attach(win: Window) {
    this.detach();
    this.win = win;
    win.addEventListener('keydown', this.kd);
    win.addEventListener('keyup', this.ku);
    win.addEventListener('blur', this.blur);
  }

  detach() {
    if (!this.win) return;
    this.win.removeEventListener('keydown', this.kd);
    this.win.removeEventListener('keyup', this.ku);
    this.win.removeEventListener('blur', this.blur);
    this.win = null;
    this.keys.clear();
  }

  axis() {
    const any = (codes: string[]) => codes.some((c) => this.keys.has(c));
    return {
      dx: (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0),
      dy: (any(DOWN) ? 1 : 0) - (any(UP) ? 1 : 0),
    };
  }
}
