import './style.css';
import { GameClient } from './client/game';
import { loadGame } from './client/save';
import { newGame } from './core/state';

// Só uma instância do jogo por vez (abas/janelas compartilham o mesmo save).
// A nova avisa as antigas, que salvam e pausam; depois ela carrega o save atualizado.
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('happyfarm') : null;
channel?.postMessage({ type: 'hello' });

setTimeout(() => {
  const state = loadGame() ?? newGame((Math.random() * 2 ** 31) | 0, Date.now());
  const game = new GameClient(document.getElementById('app')!, state);
  if (import.meta.env.DEV) Object.assign(window, { game });
  if (channel) {
    channel.onmessage = (e) => {
      if (e.data?.type === 'hello') game.suspend('O jogo foi aberto em outra aba ou janela.');
    };
  }
}, channel ? 150 : 0);
