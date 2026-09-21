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
