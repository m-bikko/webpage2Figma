import type { Diagnostic, DiagnosticCode, DiagnosticLevel } from '@h2d/ir'

/** Собирает диагностику одного экрана.
 *
 *  Коды не определяются здесь: они живут в `@h2d/ir`, потому что их обязан
 *  знать плагин Figma, а импортировать из сериализатора он не может —
 *  тот собирается как IIFE для контекста страницы. */
export class DiagnosticSink {
  private readonly items: Diagnostic[] = []
  private readonly seen = new Set<string>()

  constructor(private readonly screenId: string) {}

  /** `needsPlaceholder` обязателен намеренно: значение по умолчанию
   *  приглашает забыть, а забытая заглушка означает, что неподдерживаемая
   *  фича приедет в Figma обычной пустой коробкой. Пусть каждый вызов
   *  решает явно.
   *
   *  Семантика — только ЗАМЕНА: `true` означает, что узел по `nodeId`
   *  обязан быть `kind: 'placeholder'`. Коды, которые лишь помечают узел
   *  с реальным содержимым, передают `false`. */
  report(
    level: DiagnosticLevel,
    code: DiagnosticCode,
    message: string,
    nodeId: string | null,
    needsPlaceholder: boolean,
  ): void {
    /** Дедупликация по паре код + узел. Один и тот же изъян на одном узле
     *  не должен попадать в отчёт дважды, но тот же изъян на другом узле —
     *  отдельная запись: пользователю нужно знать, сколько мест затронуто. */
    const key = `${code}|${nodeId ?? '<null>'}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.items.push({
      level, code, message, nodeId, screenId: this.screenId, needsPlaceholder,
    })
  }

  /** Отдаёт копию: вызывающий не должен иметь возможности испортить
   *  накопленное, и читать отчёт можно многократно. */
  drain(): Diagnostic[] {
    return [...this.items]
  }
}
