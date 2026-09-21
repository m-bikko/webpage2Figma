import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { serializer: 'src/global.ts' },
  format: ['iife'],
  globalName: 'H2DSerializer',
  outExtension: () => ({ js: '.global.js' }),
  target: 'chrome120',
  sourcemap: true,
  clean: true,
  noExternal: ['@w2f/ir'],
})
