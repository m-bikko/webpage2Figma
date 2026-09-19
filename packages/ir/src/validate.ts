import { checkInvariants } from './invariants.js'
import { bundleSchema } from './schema.js'
import type { Bundle } from './types.js'
import { IR_VERSION, type BundleEnvelope } from './version.js'

export type ParseResult =
  | { ok: true; bundle: Bundle }
  | { ok: false; error: string }

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
    const lines = violations.map((v) => `  • ${v.path}: ${v.message}`).join('\n')
    return {
      ok: false,
      error: `Бандл валиден по форме, но нарушает инварианты:\n${lines}`,
    }
  }

  return { ok: true, bundle: parsed.data }
}
