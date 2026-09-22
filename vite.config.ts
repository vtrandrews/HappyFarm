import { defineConfig } from 'vite';

export default defineConfig({
  // caminhos relativos: o build roda de qualquer pasta/servidor interno
  base: './',
  server: { host: true, port: 5180, strictPort: true },
});
