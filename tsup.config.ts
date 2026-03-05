import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: true,
  },
  {
    entry: {
      cli: 'src/cli.ts',
      'redocly/plugin': 'src/redocly/plugin.ts',
    },
    format: ['esm'],
    dts: true,
    outDir: 'dist',
  },
]);
