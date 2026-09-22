/** СНИМОК `<canvas>`.
 *
 *  Содержимое канвы рисует скрипт, и в разметке его нет — поэтому она
 *  приезжала заглушкой. Но у канвы есть `toDataURL`, и это не
 *  приближение: браузер отдаёт ровно те пиксели, что показывает.
 *  Графики и визуализации — обычно именно то, ради чего страницу и
 *  снимают; на живых страницах таких канв по 6–12 на штуку.
 *
 *  ДВА СЛУЧАЯ, когда снимок брать нельзя, и оба обязаны кончаться
 *  заглушкой, а не пустой картинкой.
 *
 *  Первый — «загрязнённая» канва: если на неё рисовали изображение с
 *  чужого источника без разрешения, `toDataURL` отказывает
 *  исключением. Это защита браузера, обойти её нечем.
 *
 *  Второй — пустой результат. Канва может быть действительно пустой, а
 *  может быть нарисованной через WebGL без сохранённого буфера: тогда
 *  `toDataURL` молча отдаёт прозрачный прямоугольник. Различить их
 *  снаружи нельзя, но и не нужно — в обоих случаях переносить нечего,
 *  а пустая картинка на месте графика неотличима от потерянной.
 *
 *  Пустоту определяет СРАВНЕНИЕ с чистой канвой того же размера.
 *  Проверять тип контекста было бы надёжнее, но `getContext('2d')` на
 *  канве без контекста его СОЗДАЁТ — и следующий вызов страницы за
 *  WebGL получил бы `null`. Захват снимает живую страницу
 *  пользователя и не вправе её менять. */

export type CanvasSnapshot =
  | { kind: 'image'; dataUrl: string; width: number; height: number }
  | { kind: 'tainted' }
  | { kind: 'empty' }

export const snapshotCanvas = (el: HTMLCanvasElement): CanvasSnapshot => {
  if (el.width === 0 || el.height === 0) return { kind: 'empty' }

  let dataUrl: string
  try {
    dataUrl = el.toDataURL('image/png')
  } catch {
    return { kind: 'tainted' }
  }
  if (!dataUrl.startsWith('data:image/png')) return { kind: 'empty' }

  /** Эталон пустоты: новая канва тех же размеров. Она не вставляется
   *  в документ, поэтому страница от неё не меняется. */
  const blank = document.createElement('canvas')
  blank.width = el.width
  blank.height = el.height
  let blankUrl: string
  try {
    blankUrl = blank.toDataURL('image/png')
  } catch {
    /** Эталон снять не удалось — сравнивать не с чем. Снимок при этом
     *  есть, и отдать его лучше, чем выбросить: худшее, что может
     *  выйти, — прозрачный прямоугольник вместо заглушки. */
    return { kind: 'image', dataUrl, width: el.width, height: el.height }
  }

  if (dataUrl === blankUrl) return { kind: 'empty' }
  return { kind: 'image', dataUrl, width: el.width, height: el.height }
}
