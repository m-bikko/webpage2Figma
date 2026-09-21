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
 *  ПОЧЕМУ НУЖЕН РАЗМЕР БОКСА. `gradientTransform` действует на
 *  НОРМАЛИЗОВАННЫХ координатах слоя, где бокс — единичный квадрат.
 *  Нормализация неравномерна, поэтому «перпендикуляр» в ней не
 *  перпендикуляр на экране. Для горизонтальных и вертикальных
 *  градиентов это безразлично — вдоль них цвет постоянен, — а для
 *  диагонального нет.
 *
 *  Первая редакция строила матрицу прямо в нормализованных
 *  координатах. На боксе 800×160 с `linear-gradient(135deg, …)`
 *  отношение вкладов осей вышло 0.2 вместо 5.0: градиент шёл почти
 *  вертикально там, где должен почти горизонтально. Круговой обход
 *  этого не видел и видеть не мог — он использует то же соглашение в
 *  обе стороны. Нашлось ЗАМЕРОМ: экспорт из настоящей Figma дал 31429
 *  расходящихся пикселей, симметрично по краям.
 *
 *  Как строится теперь. Размещение задаётся В ПИКСЕЛЯХ: матрица `P`
 *  переводит пространство градиента в пиксели, отправляя (0,0) в
 *  начало, а (1,0) — в конец. Дальше нужно из нормализованных
 *  координат попасть в пространство градиента, то есть
 *
 *      M = P⁻¹ · diag(w, h, 1)
 *
 *  Сначала нормализованные разворачиваются в пиксели, потом пиксели
 *  переводятся в градиент. Соглашение о том, что матрица обратна
 *  размещению, документацией по-прежнему не подтверждено — но теперь
 *  подтверждено замером на горизонтальном, вертикальном и угловом
 *  градиентах, которые сошлись пиксель в пиксель. */
export const gradientPaint = (
  gradient: Gradient,
  /** Размер бокса в пикселях. Без него матрица неверна на любом
   *  неквадратном боксе с диагональным градиентом. */
  box: { w: number; h: number },
): Extract<ScenePaint, { type: 'GRADIENT_LINEAR' }> => {
  const stops = gradient.stops.map((stop) => ({
    position: stop.offset,
    color: figmaRgba(stop.color),
  }))

  /** Направление и начало В ПИКСЕЛЯХ, а не в долях бокса. */
  const px = {
    fromX: gradient.from.x * box.w,
    fromY: gradient.from.y * box.h,
    dx: (gradient.to.x - gradient.from.x) * box.w,
    dy: (gradient.to.y - gradient.from.y) * box.h,
  }

  const determinant = px.dx * px.dx + px.dy * px.dy
  /** Вырожденный градиент: начало совпало с концом. Обращать нечего;
   *  отдаём тождественную матрицу. Молча поделить на ноль значило бы
   *  выдать матрицу из NaN, которую Figma примет и нарисует неизвестно
   *  что. */
  if (determinant === 0) {
    return {
      type: 'GRADIENT_LINEAR',
      gradientTransform: [[1, 0, 0], [0, 1, 0]],
      gradientStops: stops,
    }
  }

  /** Матрица РАЗМЕЩЕНИЯ в пикселях: (0,0) → начало, (1,0) → конец.
   *  Вторая ось перпендикулярна первой и той же длины. */
  const a = px.dx
  const b = px.dy
  const c = -px.dy
  const d = px.dx
  const e = px.fromX
  const f = px.fromY

  /** `P⁻¹`, а затем домножение на `diag(w, h, 1)` справа: сначала
   *  нормализованные координаты разворачиваются в пиксели, потом
   *  пиксели переводятся в пространство градиента. */
  const inverse: Matrix2x3 = [
    [(d / determinant) * box.w, (-c / determinant) * box.h,
     (c * f - d * e) / determinant],
    [(-b / determinant) * box.w, (a / determinant) * box.h,
     (b * e - a * f) / determinant],
  ]

  return {
    type: 'GRADIENT_LINEAR',
    gradientTransform: inverse,
    gradientStops: stops,
  }
}
