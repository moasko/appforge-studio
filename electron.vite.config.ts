import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    // Une seule copie des paquets CodeMirror : sinon les facets (state, language, autocompletion)
    // sont dupliquées entre le bundle de @uiw/react-codemirror et les imports directs.
    optimizeDeps: {
      include: [
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@codemirror/autocomplete',
        '@codemirror/commands',
        '@codemirror/search',
        '@codemirror/lint',
        '@codemirror/lang-javascript',
        '@codemirror/lang-json',
        '@codemirror/lang-css',
        '@codemirror/lang-html',
        '@codemirror/lang-markdown',
        '@codemirror/theme-one-dark',
        '@lezer/common',
        '@lezer/highlight',
        '@uiw/react-codemirror'
      ]
    },
    plugins: [react()]
  }
})
