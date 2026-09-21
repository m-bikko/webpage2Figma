/** Заявка на байты изображения, поданная СИНХРОННЫМ обходом DOM.
 *
 *  Обход не забирает байты сам и не может: `await` внутри него отдаёт
 *  управление циклу событий, за это время раскладка меняется
 *  (дочитывается ленивое изображение, доигрывает анимация, срабатывает
 *  IntersectionObserver), и узлы, снятые до паузы и после, описывают
 *  РАЗНЫЕ состояния страницы — тогда как IR утверждает, что это один
 *  кадр. Такая порча невидима и для валидатора, и для pixel-diff: оба
 *  сравнивают то, что доехало, а внутренняя противоречивость им не
 *  видна. Поэтому байты забирает отдельная асинхронная фаза. */
export type AssetRequest = {
  id: string
  url: string
  /** Собственный размер источника. Нужен фазе разрешения, чтобы решить
   *  про масштабирование, не дожидаясь декодирования. */
  naturalWidth: number
  naturalHeight: number
  /** Первый узел, которому ассет понадобился. Сообщение об отказе без
   *  узла не говорит, куда смотреть; при дедупликации остаётся первый. */
  nodeId: string
  /** Экран этого узла. Нужен потому, что `Diagnostic` привязан к экрану,
   *  а ассеты живут на уровне бандла: без этого поля отказ по ассету
   *  оказался бы записью без адреса. */
  screenId: string
}

/** Живёт на уровне ЗАХВАТА, а не экрана — так же, как аллокатор
 *  идентификаторов узлов (см. комментарий в `global.ts`). Инвариант
 *  `asset.dangling` проверяет ссылки в пределах бандла, и один логотип
 *  на пяти экранах обязан быть одним ассетом, а не пятью копиями. */
export class AssetRequests {
  private readonly byUrl = new Map<string, string>()
  private readonly items: AssetRequest[] = []
  private counter = 0

  request(
    url: string,
    naturalWidth: number,
    naturalHeight: number,
    nodeId: string,
    screenId: string,
  ): string {
    const existing = this.byUrl.get(url)
    if (existing !== undefined) return existing

    const id = `a${this.counter}`
    this.counter += 1
    this.byUrl.set(url, id)
    this.items.push({ id, url, naturalWidth, naturalHeight, nodeId, screenId })
    return id
  }

  drain(): AssetRequest[] {
    return [...this.items]
  }
}
