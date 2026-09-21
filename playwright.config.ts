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
    /** Переиспользование ВЫКЛЮЧЕНО намеренно.
     *
     *  Сервер фикстур — такой же код, как всё остальное, и он меняется:
     *  в нём появилась задержка ответа, чтобы воспроизводить
     *  незагруженную картинку. С `reuseExistingServer: true` прогон
     *  молча берёт уже запущенный экземпляр — возможно, поднятый до
     *  правки, — и проверяет старое поведение. Так и случилось: тест на
     *  ожидание картинки проходил без всякой реализации, потому что
     *  старый сервер отдавал её мгновенно.
     *
     *  Ценой служит отказ при занятом порте. Это громко и правильно:
     *  лучше не запуститься, чем проверить не то. */
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
