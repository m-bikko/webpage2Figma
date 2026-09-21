import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { code: 'src/main.ts' },
  format: ['iife'],
  target: 'es2020',
  sourcemap: true,
  clean: true,
  /** ВСЁ втягивается в один файл. Рантайм плагина Figma не умеет
   *  импортов вовсе: он получает один скрипт и выполняет его. Оставить
   *  что-нибудь внешним значит получить отказ при запуске, а не при
   *  сборке. */
  noExternal: [/.*/],
})
