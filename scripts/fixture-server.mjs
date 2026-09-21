/** Статический сервер фикстур.
 *
 *  Нужен не для удобства. Под `file://` Chrome считает документ
 *  непрозрачным источником: `OffscreenCanvas` отравлена
 *  (`SecurityError` при `convertToBlob`), `fetch` запрещён
 *  (`TypeError: Failed to fetch`) — то есть весь успешный путь работы с
 *  изображениями не выполняется ни разу, и гейт проверял бы только путь
 *  отказа. Измерено в том же Chromium, что и тесты.
 *
 *  Порт фиксирован: его знают и `playwright.config.ts`, и
 *  `scripts/capture.mjs`, а согласовывать динамический между отдельными
 *  процессами нечем.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURE_PORT = 4317

/** Второй порт — ВТОРОЙ ИСТОЧНИК. Тот же хост и те же файлы, но по
 *  правилам браузера это чужой origin, и заголовков CORS сервер не
 *  шлёт. Нужен для единственного случая, который иначе непроверяем:
 *  картинка ОТРИСОВАЛАСЬ (изображения не ограничены CORS для показа),
 *  то есть заявка подана, а `fetch` её байты не отдаёт.
 *
 *  Это не экзотика, а доминирующий случай в жизни: любая картинка с
 *  чужого CDN ведёт себя ровно так. Без второго порта путь отказа
 *  фазы разрешения не выполнялся бы ни разу. */
export const FIXTURE_ALT_PORT = 4318

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

export const createFixtureServer = () => createServer(async (req, res) => {
  const requested = decodeURIComponent((req.url ?? '/').split('?')[0])
  /** Защита от выхода за корень. Сервер локальный и живёт секунды, но
   *  путь приходит из строки, а «локальный и ненадолго» — не свойство
   *  кода, а обстоятельство, которое может перестать быть верным. */
  const target = normalize(join(root, requested))
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  try {
    const body = await readFile(target)
    res.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      /** Кеш выключен: тест обязан видеть текущий файл, а не тот,
       *  что лежал здесь на прошлом прогоне. */
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})

/** Запуск как самостоятельного процесса — так его поднимает Playwright. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createFixtureServer().listen(FIXTURE_PORT, '127.0.0.1', () => {
    console.log(`фикстуры на http://127.0.0.1:${FIXTURE_PORT}/`)
  })
  createFixtureServer().listen(FIXTURE_ALT_PORT, '127.0.0.1', () => {
    console.log(`чужой источник на http://127.0.0.1:${FIXTURE_ALT_PORT}/`)
  })
}
