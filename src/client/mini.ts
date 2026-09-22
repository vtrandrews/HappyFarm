// Modo mini: move o jogo inteiro pra uma janelinha "sempre por cima" usando a
// Document Picture-in-Picture API (Chrome/Edge 116+). Fica no cantinho da tela
// enquanto você trabalha em outras janelas.

interface DocumentPiP {
  requestWindow(opts?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPiP;
  }
}

const SIZE_KEY = 'happyfarm:pipSize';

/** Reabre a janelinha no último tamanho que o jogador deixou. */
function loadSize(): { width: number; height: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null');
    if (s?.width >= 200 && s?.height >= 150) return { width: s.width, height: s.height };
  } catch {
    /* ignore */
  }
  return { width: 420, height: 320 };
}

function saveSize(width: number, height: number) {
  try {
    if (width >= 200 && height >= 150) localStorage.setItem(SIZE_KEY, JSON.stringify({ width, height }));
  } catch {
    /* ignore */
  }
}

export class MiniMode {
  pip: Window | null = null;

  constructor(
    private root: HTMLElement,
    private home: HTMLElement,
    private onWindowChange: (win: Window) => void,
  ) {}

  get supported() {
    return !!window.documentPictureInPicture;
  }

  get active() {
    return !!this.pip;
  }

  async toggle() {
    if (this.pip) this.close();
    else await this.open();
  }

  close() {
    this.pip?.close();
  }

  private async open() {
    const pip = await window.documentPictureInPicture!.requestWindow(loadSize());
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      pip.document.head.append(node.cloneNode(true));
    }
    pip.document.title = document.title;
    pip.document.body.append(this.root);
    this.root.classList.add('in-pip');
    this.pip = pip;
    pip.addEventListener('pagehide', () => {
      saveSize(pip.innerWidth, pip.innerHeight);
      this.home.append(this.root);
      this.root.classList.remove('in-pip');
      this.pip = null;
      this.onWindowChange(window);
    });
    this.onWindowChange(pip);
  }
}
