/** Пять экранов, ради которых всё и затевалось. Те же размеры, что у
 *  гейта: расширение и тесты обязаны снимать одно и то же, иначе
 *  сравнивать их бессмысленно. */
export const BREAKPOINTS = [
  { name: 'Desktop XL', width: 1920, height: 1080 },
  { name: 'Desktop', width: 1440, height: 900 },
  { name: 'Tablet L', width: 1024, height: 1366 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 390, height: 844 },
] as const

export type Breakpoint = { name: string; width: number; height: number }

/** Ключ брейкпоинта для хранения выбора. Ширина, а не имя: имя может
 *  поменяться, ширина — это и есть суть. */
export const keyOf = (size: Breakpoint): string => String(size.width)

/** Выбранные брейкпоинты по сохранённым ключам.
 *
 *  Пустой или отсутствующий выбор означает ВСЕ ПЯТЬ, а не ни одного:
 *  расширение, запущенное впервые, обязано работать без настройки, а
 *  пустой экран в ответ на кнопку выглядел бы поломкой.
 *
 *  Порядок берётся из `BREAKPOINTS`, а не из сохранённого списка: он
 *  задан от широкого к узкому, и менять его выбором пользователя
 *  значило бы раскладывать экраны в случайном порядке. */
export const selectedBreakpoints = (
  keys: readonly string[] | undefined,
): Breakpoint[] => {
  if (keys === undefined || keys.length === 0) return [...BREAKPOINTS]
  const wanted = new Set(keys)
  const chosen = BREAKPOINTS.filter((size) => wanted.has(keyOf(size)))
  /** Ни одного совпадения — значит сохранён мусор от старой редакции.
   *  Снимать нечего, и честнее снять всё, чем ничего. */
  return chosen.length === 0 ? [...BREAKPOINTS] : chosen
}

/** Выполняет действие при заданном размере вьюпорта.
 *
 *  ОТСОЕДИНЕНИЕ В `finally` ОБЯЗАТЕЛЬНО, и это не осторожность.
 *  У `Emulation.setDeviceMetricsOverride` нет срока годности: если
 *  воркер упадёт между `attach` и `detach`, вкладка останется с
 *  подменёнными метриками и жёлтой плашкой «расширение отлаживает этот
 *  браузер», и вернуть её в норму пользователь сможет только
 *  перезагрузкой. Отладчик в MV3 переживает падение обработчика.
 *
 *  `clearDeviceMetricsOverride` вызывается ОТДЕЛЬНО от `detach`:
 *  отсоединение само по себе метрики не снимает, если к вкладке
 *  подключён кто-то ещё — например, открытый DevTools. */
export const withViewport = async <T>(
  tabId: number,
  size: Breakpoint,
  body: () => Promise<T>,
): Promise<T> => {
  const target: chrome.debugger.Debuggee = { tabId }
  await chrome.debugger.attach(target, '1.3')
  try {
    /** `await` здесь НЕ про порядок: CDP упорядочивает команды на одну
     *  цель сам, и замер это подтвердил — без `await` тест про
     *  раскладку всё равно проходит. Он нужен ради распространения
     *  ошибки: без него отказ команды стал бы необработанным
     *  отклонением промиса, которое в MV3-воркере видно только в
     *  консоли расширения, если её открыть.
     *
     *  Записано потому, что обратное выглядит очевидным и однажды
     *  кто-нибудь «оптимизирует» это обратно. */
    await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    return await body()
  } finally {
    try {
      await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride')
    } catch {
      /** Вкладка могла закрыться — тогда снимать нечего. Глотается
       *  намеренно: отсоединение ниже важнее и обязано выполниться. */
    }
    try {
      await chrome.debugger.detach(target)
    } catch {
      /** Уже отсоединены. Не ошибка. */
    }
  }
}

/** Скриншот ПОЛНОЙ высоты содержимого, а не видимой части.
 *
 *  `chrome.tabs.captureVisibleTab` снимает только вьюпорт — для
 *  страницы выше экрана он отдал бы обрезанную картинку, и это было бы
 *  незаметно: скриншот выглядит нормальным, просто короче. Поэтому
 *  снимок делается через CDP с `captureBeyondViewport`.
 *
 *  Вызывается ВНУТРИ `withViewport`: отладчик уже подключён, а
 *  подключать его второй раз к той же вкладке нельзя. */
export const captureFullPage = async (
  tabId: number,
  width: number,
  height: number,
): Promise<string> => {
  const target: chrome.debugger.Debuggee = { tabId }
  const shot = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
    format: 'png',
    /** Флаг стоит ради ясности намерения, но НЕСУЩЕЕ здесь не он, а
     *  явная область обрезки: измерено — с `captureBeyondViewport:
     *  false` и той же областью снимок получается таким же. Записано,
     *  чтобы никто не считал флаг работающим сам по себе и не выбросил
     *  вместо него область. */
    captureBeyondViewport: true,
    /** Область задаётся ЯВНО обеими сторонами. Нулевая ширина — не
     *  «вся»: CDP отвечает «Cannot take screenshot with 0 width».
     *  А высота берётся из `screen.height`, то есть из содержимого, а
     *  не из вьюпорта: без этого короткая страница дала бы скриншот
     *  ниже своего фрейма, и pixel-diff сравнивал бы разное. */
    clip: { x: 0, y: 0, width, height, scale: 1 },
  }) as { data?: string } | undefined
  const data = shot?.data
  if (typeof data !== 'string') {
    throw new Error('CDP не вернул скриншот: снимать нечего или вкладка закрылась.')
  }
  return data
}

/** Ждёт, пока картинки страницы догрузятся.
 *
 *  Зачем. На живых страницах картинки грузятся лениво, и снимок сразу
 *  после смены размера застаёт их незагруженными: `naturalWidth`
 *  нулевой, узел становится заглушкой. Найдено на захвате настоящей
 *  страницы — так потерялись восемь картинок из двадцати восьми
 *  недоступных.
 *
 *  Смена размера вьюпорта сама по себе вызывает загрузку новых
 *  картинок: медиазапросы, `srcset`, ленивые изображения, попавшие в
 *  видимую область. Поэтому ждать надо ПОСЛЕ эмуляции, а не до.
 *
 *  Ожидание ОГРАНИЧЕНО по времени и не молчит. Картинка может не
 *  загрузиться никогда — битая ссылка, мёртвый домен, — и ждать её
 *  вечно значит не отдать пользователю ничего. По истечении срока
 *  съёмка идёт дальше, а незагруженное честно станет заглушкой с
 *  диагностикой: это уже умеет сериализатор. */
export const waitForImages = async (
  tabId: number,
  timeoutMs = 3000,
): Promise<{ waited: number; pending: number }> => {
  const started = Date.now()
  for (;;) {
    const probe = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      /** `Array.from`, а не распыление: `HTMLCollection` итерируема в
       *  рантайме, но её тип в конфигурации проекта — нет. */
      func: () => Array.from(document.images)
        .filter((img) => !img.complete).length,
    })
    const pending = probe[0]?.result ?? 0
    if (pending === 0) return { waited: Date.now() - started, pending: 0 }
    if (Date.now() - started >= timeoutMs) {
      return { waited: Date.now() - started, pending }
    }
    await new Promise((done) => { setTimeout(done, 50) })
  }
}
