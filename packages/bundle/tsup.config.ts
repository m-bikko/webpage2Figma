import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  /** `@h2d/ir` вшивается, а не остаётся внешним. Причина не в размере:
   *  его `exports` указывают на `.ts`, который обычный Node прочитать
   *  не может, а `parseBundle` нужен здесь во ВРЕМЯ ВЫПОЛНЕНИЯ — в
   *  отличие от референс-рендерера, который берёт из контракта только
   *  типы, а они стираются при компиляции.
   *
   *  `fflate` оставлен внешним: это обычная зависимость из node_modules,
   *  и вшивать её значило бы дублировать код при каждой пересборке. */
  noExternal: ['@h2d/ir'],
  external: ['fflate'],
})
