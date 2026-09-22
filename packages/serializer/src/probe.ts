/** Минимальный набор свойств, влияющих на участие узла в стекинге.
 *  Отделён от DOM ради тестируемости резолвера. */
export type LayoutProbe = {
  id: string
  position: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky'
  zIndex: number | 'auto'
  opacity: number
  hasTransform: boolean
  hasFilter: boolean
  hasMixBlendMode: boolean
  isIsolated: boolean
  isFloat: boolean
  isInline: boolean
  parentIsFlexOrGrid: boolean
  children: LayoutProbe[]
}

export const readProbe = (
  el: Element,
  cs: CSSStyleDeclaration,
  parentCs: CSSStyleDeclaration | null,
): Omit<LayoutProbe, 'children'> => {
  const zIndexRaw = cs.zIndex
  const parentDisplay = parentCs === null ? '' : parentCs.display
  return {
    id: '',
    position: cs.position as LayoutProbe['position'],
    zIndex: zIndexRaw === 'auto' ? 'auto' : Number.parseInt(zIndexRaw, 10),
    /** `visibility: hidden` выражается нулевой непрозрачностью — ТА ЖЕ
     *  величина, что в `readStyle`. Два источника, считающие её
     *  по-разному, дали узел с нулём в стиле и единицей в пробе:
     *  рендерер не оборачивал его в группу и рисовал текст скрытого
     *  элемента как видимый. Один источник истины — здесь. */
    opacity: cs.visibility === 'hidden' ? 0 : Number.parseFloat(cs.opacity),
    hasTransform: cs.transform !== 'none',
    hasFilter: cs.filter !== 'none' || cs.backdropFilter !== 'none',
    hasMixBlendMode: cs.mixBlendMode !== 'normal',
    isIsolated: cs.isolation === 'isolate' || cs.contain.includes('paint'),
    isFloat: cs.float !== 'none',
    isInline: cs.display.startsWith('inline'),
    parentIsFlexOrGrid: /flex|grid/.test(parentDisplay),
  }
}
