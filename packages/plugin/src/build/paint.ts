import type { Gradient, Rgba8 } from '@h2d/ir'
import type { FigmaColor, FigmaRgba, ScenePaint } from '../scene.js'

/** Цвет в представлении Figma: доли `0..1`, альфа НЕ входит.
 *
 *  Разведение не косметическое. В Figma прозрачность краски живёт в её
 *  `opacity`, а не в цвете, и сложить их обратно нельзя: у узла есть
 *  ещё собственная непрозрачность, которая на неё домножается. */
export const figmaColor = (color: Rgba8): FigmaColor => ({
  r: color.r / 255,
  g: color.g / 255,
  b: color.b / 255,
})

/** Цвет С АЛЬФОЙ внутри — форма `RGBA`. Нужна там, где Figma держит
 *  альфу в цвете: тени и остановки градиента. Путать её с цветом
 *  краски нельзя, и компилятор теперь этого не даст. */
export const figmaRgba = (color: Rgba8): FigmaRgba => ({
  r: color.r / 255, g: color.g / 255, b: color.b / 255, a: color.a,
})

export const solidPaint = (color: Rgba8): ScenePaint => ({
  type: 'SOLID',
  color: figmaColor(color),
  opacity: color.a,
})

type Matrix2x3 = [[number, number, number], [number, number, number]]

/** Градиентная краска Figma.
 *
 *  ЧЕСТНО О ПРЕДЕЛАХ ПРОВЕРКИ. Документация говорит про
 *  `gradientTransform` ровно одну строку — «the positioning of the
 *  gradient within the layer» — и формулы не даёт. Соглашение, принятое
 *  здесь, общеизвестно, но документацией не подтверждено: матрица
 *  переводит нормализованные координаты слоя в пространство градиента,
 *  где тот идёт вдоль оси X от 0 до 1. То есть она ОБРАТНА матрице
 *  размещения ручек.
 *
 *  Что из этого следует для проверок. Круговой обход через `sceneToIr`
 *  использует то же соглашение, поэтому системную ошибку в понимании
 *  матрицы он поймать НЕ МОЖЕТ — он самосогласован. Он ловит всё
 *  остальное: потерю градиента, перепутанный порядок остановок,
 *  потерянную альфу, неверную нормализацию позиций. Это разные классы
 *  дефектов, и делать вид, что покрыты оба, нельзя.
 *
 *  Частичная опора на документацию всё же есть: она утверждает, что
 *  тождественная матрица — `[[1,0,0],[0,1,0]]`, а поворот имеет вид
 *  `[[cos, sin, 0], [-sin, cos, 0]]`. Горизонтальный и вертикальный
 *  градиенты сверяются с этими двумя фактами в тестах.
 *
 *  Соглашение отмечается в `needsVerification` и подлежит сверке
 *  человеком в Figma один раз. */
export const gradientPaint = (gradient: Gradient): Extract<ScenePaint, { type: 'GRADIENT_LINEAR' }> => {
  const dx = gradient.to.x - gradient.from.x
  const dy = gradient.to.y - gradient.from.y

  /** Матрица РАЗМЕЩЕНИЯ: переводит пространство градиента в слой,
   *  отправляя (0,0) в `from`, а (1,0) — в `to`. Вторая ось
   *  перпендикулярна первой и той же длины: градиент не скошен. */
  const placement: Matrix2x3 = [
    [dx, -dy, gradient.from.x],
    [dy, dx, gradient.from.y],
  ]

  const determinant = dx * dx + dy * dy
  /** Вырожденный градиент — `from` совпал с `to`. Обратить нечего;
   *  отдаём тождественную матрицу, а вызывающий обязан сообщить.
   *  Молча поделить на ноль значило бы отдать матрицу из NaN, которую
   *  Figma примет и нарисует неизвестно что. */
  if (determinant === 0) {
    return {
      type: 'GRADIENT_LINEAR',
      gradientTransform: [[1, 0, 0], [0, 1, 0]],
      gradientStops: gradient.stops.map((stop) => ({
        position: stop.offset,
        color: figmaRgba(stop.color),
      })),
    }
  }

  const [[a, c, e], [b, d, f]] = placement
  const inverse: Matrix2x3 = [
    [d / determinant, -c / determinant, (c * f - d * e) / determinant],
    [-b / determinant, a / determinant, (b * e - a * f) / determinant],
  ]

  return {
    type: 'GRADIENT_LINEAR',
    gradientTransform: inverse,
    gradientStops: gradient.stops.map((stop) => ({
      position: stop.offset,
      color: figmaRgba(stop.color),
    })),
  }
}
