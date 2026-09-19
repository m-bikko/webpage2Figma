import { checkInvariants } from './invariants.js'
import type { InvariantError } from './invariants.js'
import { bundleSchema } from './schema.js'
import type { Bundle } from './types.js'
import { IR_VERSION, type BundleEnvelope } from './version.js'

export type ParseResult =
  | { ok: true; bundle: Bundle }
  | { ok: false; error: string }

/** Сколько нарушений одного `code` печатать целиком, прежде чем свернуть
 *  остаток. На бандле с 200 узлами одинакового `paintOrder` неограниченный
 *  вывод даёт сообщение в десятки тысяч символов — почти идентичные строки,
 *  отправленные в UI плагина Figma. Политика «сообщать обо всех нарушениях»
 *  верна, но без предела она опровергает себя именно на том бандле, где
 *  нужна больше всего. */
const MAX_PER_CODE = 10

/** Группирует по `code`, печатает первые `MAX_PER_CODE` каждого вида
 *  и сворачивает остаток в «…и ещё N того же вида», вместо построчного
 *  вывода всех нарушений без разбора. */
const formatViolations = (violations: InvariantError[]): string => {
  const byCode = new Map<string, InvariantError[]>()
  for (const violation of violations) {
    const group = byCode.get(violation.code)
    if (group === undefined) byCode.set(violation.code, [violation])
    else group.push(violation)
  }

  const lines: string[] = []
  for (const group of byCode.values()) {
    for (const violation of group.slice(0, MAX_PER_CODE)) {
      lines.push(`  • ${violation.path}: ${violation.message}`)
    }
    const rest = group.length - MAX_PER_CODE
    if (rest > 0) {
      lines.push(`  …и ещё ${rest} того же вида`)
    }
  }
  return lines.join('\n')
}

/** Порядок проверок продуман: конверт, потом версия, потом форма, потом смысл.
 *  Каждая ступень даёт сообщение, которое человек может прочитать, вместо
 *  простыни zod поверх файла, который вообще не наш. */
export const parseBundle = (input: unknown): ParseResult => {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Бандл не является объектом.' }
  }

  const envelope = input as BundleEnvelope

  if (envelope.format !== 'h2d') {
    return {
      ok: false,
      error:
        'Файл не похож на бандл html2design: отсутствует маркер формата. ' +
        'Выбери файл .h2d, созданный расширением.',
    }
  }

  if (envelope.version !== IR_VERSION) {
    return {
      ok: false,
      error:
        `Несовместимая версия IR: в файле ${String(envelope.version)}, ` +
        `эта половина ожидает ${IR_VERSION}. ` +
        `Обнови extension и плагин Figma до одной версии — бандл ` +
        `односверсионный артефакт, миграции не предусмотрены.`,
    }
  }

  const parsed = bundleSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first === undefined ? '<корень>' : first.path.join('.')
    const message = first === undefined ? 'неизвестная ошибка' : first.message
    return { ok: false, error: `Бандл повреждён в поле "${path}": ${message}` }
  }

  /** Инварианты сообщаются ВСЕ, а не до первого: они обычно следствие одной
   *  причины, и полный список экономит цикл «починил — снова упало». */
  const violations = checkInvariants(parsed.data)
  if (violations.length > 0) {
    return {
      ok: false,
      error: `Бандл валиден по форме, но нарушает инварианты:\n${formatViolations(violations)}`,
    }
  }

  return { ok: true, bundle: parsed.data }
}
