import { DIAGNOSTIC_CODES } from './codes.js'
import type { Diagnostic, Fill, IrNode, Screen } from './types.js'

/** Приводит дерево в согласие с тем, что реально доехало.
 *
 *  Нужна из-за двухфазности захвата, и это не изъян модели, а её цена.
 *  Обход DOM обязан быть синхронным — `await` внутри него позволил бы
 *  раскладке измениться на полпути. Поэтому узел изображения строится
 *  ДО того, как выяснится, отдаст ли источник байты. Для кросс-доменной
 *  картинки он их не отдаст почти никогда, а такая картинка на странице
 *  скорее правило, чем исключение.
 *
 *  Без этого шага узел ссылался бы на несуществующий ассет, инвариант
 *  `asset.dangling` отверг бы бандл целиком, и захват любой страницы с
 *  картинкой с чужого CDN оказался бы непригоден. Найдено гейтом:
 *  фикстура `image-cors` роняла рендерер на всех пяти ширинах.
 *
 *  Заглушка, а не тихое удаление: дыра без следа неотличима от
 *  прозрачного места, и пользователь не узнал бы, что картинка
 *  потерялась. */
export const reconcileAssets = (
  screen: Screen,
  available: ReadonlySet<string>,
): { screen: Screen; report: Diagnostic[] } => {
  const report: Diagnostic[] = []

  const keepFill = (fill: Fill, nodeId: string): boolean => {
    if (fill.kind !== 'image') return true
    if (available.has(fill.ref.assetId)) return true
    report.push({
      level: 'warning',
      code: DIAGNOSTIC_CODES.imageUnreadable,
      message:
        `Фоновое изображение "${fill.ref.assetId}" не доехало и снято с узла. ` +
        `Узел остаётся со своим цветом, если он был.`,
      nodeId, screenId: screen.id, needsPlaceholder: false,
    })
    return false
  }

  const visit = (node: IrNode): IrNode => {
    const children = node.children.map(visit)
    const fills = node.style.fills.filter((fill) => keepFill(fill, node.id))
    const style = fills.length === node.style.fills.length
      ? node.style
      : { ...node.style, fills }

    if (node.kind === 'image' && !available.has(node.image.assetId)) {
      report.push({
        level: 'warning',
        code: DIAGNOSTIC_CODES.imageUnreadable,
        message:
          `Изображение "${node.image.assetId}" не доехало: узел заменён ` +
          `заглушкой, чтобы потеря была видна, а не выглядела пустым местом.`,
        nodeId: node.id, screenId: screen.id, needsPlaceholder: true,
      })
      return {
        ...node, kind: 'placeholder', style, children,
        placeholder: { code: DIAGNOSTIC_CODES.imageUnreadable, label: 'img' },
      }
    }
    return { ...node, style, children } as IrNode
  }

  return { screen: { ...screen, root: visit(screen.root) }, report }
}
