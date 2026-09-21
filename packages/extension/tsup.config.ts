import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { worker: 'src/worker.ts', popup: 'src/popup.ts' },
  format: ['esm'],
  target: 'chrome120',
  sourcemap: true,
  clean: true,
  /** Платформа БРАУЗЕР — та же ловушка, что в плагине: под платформу
   *  Node esbuild берёт у `fflate` ветку с поддержкой воркеров, которая
   *  начинается с `require("module")`. В service worker расширения
   *  `require` не существует, и бандл падает на первой строке. */
  platform: 'browser',
  noExternal: [/.*/],
})
