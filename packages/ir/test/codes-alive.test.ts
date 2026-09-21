import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_CODES } from '../src/codes.js'

/** КАЖДЫЙ КОД ЛИБО ПОРОЖДАЕТСЯ, ЛИБО ПОМЕЧЕН КАК ИСТОРИЧЕСКИЙ.
 *
 *  Код, который никто не выдаёт, — не просто мёртвая строка. Рядом с
 *  ним живут комментарии, объясняющие, КОГДА он выдаётся, и эти
 *  объяснения переживают свою причину молча: ничто их не проверяет.
 *  Так и случилось дважды за одну работу — `deferred.vector` и
 *  `deferred.multi-layer-background` перестали порождаться вместе с
 *  реализацией векторов и слоёв фона, а три комментария в трёх файлах
 *  продолжали утверждать обратное. Нашла это сверка вики с кодом, то
 *  есть человек, а не проверка.
 *
 *  Проверка читает исходники и ищет употребление каждого имени. Она
 *  груба — совпадение по тексту, — но ровно для этого вопроса грубости
 *  достаточно: имя либо встречается в коде, который его выдаёт, либо
 *  нет. */

const here = dirname(fileURLToPath(import.meta.url))
const packages = resolve(here, '../../')

/** Коды, которые СОЗНАТЕЛЬНО оставлены при отсутствии источника.
 *
 *  Бандлы, снятые прежними версиями, их содержат, и плагин обязан
 *  такие бандлы принимать. Каждая запись обязана нести причину — без
 *  неё список превратится в свалку, куда сбрасывают всё, что мешает
 *  проверке. */
const RETIRED: Record<string, string> = {
  'deferred.vector':
    'векторы переносятся — инлайновые исходником, фоновые через ассет',
  'deferred.multi-layer-background':
    'слои фона переносятся все, каждый своей заливкой, в обратном порядке',
  'deferred.transform':
    'двумерные трансформы переносятся, непереносимые названы отдельными кодами',
  'deferred.blend':
    'режимы наложения переносятся, а изоляция группы — своим кодом',
  'fidelity.color-clamped':
    'цвета вне sRGB разбираются и приводятся без потери, сообщать не о чем',
  'fidelity.blend-isolation':
    'вложенный рендерер изолирует группы сам, случай закрыт планом 3',
  'fidelity.blur-descendant':
    'размытие действует на поддерево, случай закрыт вложенным рендерером',
  'fidelity.opacity-group':
    'непрозрачность применяется к группе целиком, случай закрыт там же',
}

const sourcesOf = (dir: string): string[] => {
  const out: string[] = []
  const walk = (path: string): void => {
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === 'dist') continue
      const full = join(path, entry)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full)
    }
  }
  walk(dir)
  return out
}

describe('таблица кодов диагностик', () => {
  it('каждый код либо порождается, либо помечен как исторический', () => {
    /** Читаются ИСХОДНИКИ всех пакетов, кроме объявления самой
     *  таблицы: иначе каждый код «находил» бы сам себя. */
    const files = sourcesOf(packages).filter(
      (file) => !file.endsWith(join('ir', 'src', 'codes.ts'))
        && !file.includes(`${join('ir', 'test')}`),
    )
    const text = files.map((file) => readFileSync(file, 'utf8')).join('\n')

    const orphans: string[] = []
    for (const [name, value] of Object.entries(DIAGNOSTIC_CODES)) {
      if (value in RETIRED) continue
      /** Ищется и имя поля (`DIAGNOSTIC_CODES.imageUnreadable`), и сама
       *  строка: часть кода пишет коды литералами, потому что не
       *  импортирует таблицу. */
      if (text.includes(name) || text.includes(`'${value}'`)) continue
      orphans.push(`${name} (${value})`)
    }

    expect(
      orphans,
      `коды без источника: ${orphans.join(', ')}. Либо их кто-то должен ` +
      `выдавать, либо они обязаны попасть в RETIRED с причиной — иначе ` +
      `комментарии рядом с ними устареют молча.`,
    ).toEqual([])
  })

  /** И обратно: запись об исчезнувшем коде выглядит как объяснение,
   *  не объясняя ничего. */
  it('в списке исторических нет кодов, которых нет в таблице', () => {
    const known = new Set(Object.values(DIAGNOSTIC_CODES))
    const stale = Object.keys(RETIRED).filter((code) => !known.has(code as never))
    expect(stale, `записи о несуществующих кодах: ${stale.join(', ')}`).toEqual([])
  })

  /** Причина обязана быть содержательной: пустая строка прошла бы
   *  проверку выше и ничего не объяснила. */
  it('у каждого исторического кода есть причина', () => {
    for (const [code, reason] of Object.entries(RETIRED)) {
      expect(reason.trim().length, `причина для ${code} пуста`)
        .toBeGreaterThan(20)
    }
  })
})
