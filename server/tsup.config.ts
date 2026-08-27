import { defineConfig } from 'tsup';
import { builtinModules } from 'node:module';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'cjs',
  target: 'node22',
  clean: true,
  bundle: true,
  minify: true,
  noExternal: [/.*/],
  external: [...builtinModules],
});
