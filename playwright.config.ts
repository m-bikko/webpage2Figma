import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    deviceScaleFactor: 1,
    hasTouch: false,
  },
  /** Фикстуры отдаются по HTTP, а не `file://`: под `file://` канва
   *  отравлена и `fetch` запрещён, поэтому успешный путь работы с
   *  изображениями не выполнялся бы ни разу. См. scripts/fixture-server.mjs. */
  webServer: {
    command: 'node scripts/fixture-server.mjs',
    url: 'http://127.0.0.1:4317/boxes/index.html',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
