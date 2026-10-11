import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Workspace lint for the non-React packages. The app keeps its own config
 * (apps/app/eslint.config.js) with the React plugins; `pnpm lint` runs both.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/app/**', 'apps/app/src-tauri/**', 'scripts/**'] },
  {
    files: ['packages/*/src/**/*.ts', 'apps/server/src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      // Eval of plugin bundles is intentional (sandbox/plugin-builder) and
      // carries a per-site eslint-disable; flag any *new* eval.
      'no-new-func': 'error'
    }
  }
)
