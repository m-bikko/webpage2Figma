import { describe, expect, it } from 'vitest'
import { AssetRequests } from '../src/assets.js'

describe('AssetRequests', () => {
  it('выдаёт идентификатор на заявку', () => {
    expect(new AssetRequests().request('https://a.test/x.png', 10, 20, 'n1'))
      .toBe('a0')
  })

  /** Дедупликация по URL — не оптимизация, а требование инварианта
   *  `asset.dangling`: он проверяет ссылки в пределах БАНДЛА. Пять
   *  экранов снимаются пятью вызовами по одной вкладке, и один и тот же
   *  логотип обязан получить один идентификатор на всех пяти, иначе
   *  бандл несёт пять копий одних байтов. */
  it('один URL даёт один идентификатор', () => {
    const requests = new AssetRequests()
    const first = requests.request('https://a.test/x.png', 10, 20, 'n1')
    const second = requests.request('https://a.test/x.png', 10, 20, 'n2')
    expect(second).toBe(first)
    expect(requests.drain()).toHaveLength(1)
  })

  it('разные URL дают разные идентификаторы', () => {
    const requests = new AssetRequests()
    expect(requests.request('https://a.test/y.png', 10, 20, 'n2'))
      .not.toBe(requests.request('https://a.test/x.png', 10, 20, 'n1'))
  })

  /** `drain` отдаёт копию по той же причине, что и `DiagnosticSink.drain`:
   *  вызывающий не должен иметь возможности испортить накопленное. */
  it('drain отдаёт копию, а не внутренний массив', () => {
    const requests = new AssetRequests()
    requests.request('https://a.test/x.png', 10, 20, 'n1')
    requests.drain().length = 0
    expect(requests.drain()).toHaveLength(1)
  })

  /** Первый узел запоминается намеренно: сообщение «байты недоступны»
   *  без указания узла не говорит, куда смотреть. */
  it('заявка помнит узел, из-за которого понадобилась', () => {
    const requests = new AssetRequests()
    requests.request('https://a.test/x.png', 64, 32, 'n7')
    expect(requests.drain()[0]).toEqual({
      id: 'a0', url: 'https://a.test/x.png',
      naturalWidth: 64, naturalHeight: 32, nodeId: 'n7',
    })
  })
})
