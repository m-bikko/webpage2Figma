import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@h2d/ir': resolve(root, 'packages/ir/src/index.ts'),
      '@h2d/serializer': resolve(root, 'packages/serializer/src/index.ts'),
      '@h2d/reference-renderer': resolve(root, 'packages/reference-renderer/src/index.ts'),
    },
  },
})
