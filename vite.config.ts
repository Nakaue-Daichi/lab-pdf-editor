import { defineConfig } from 'vite';

// GitHub Pages ではリポジトリ名がパスの先頭に付く（https://oceans-uosaka.github.io/lab-pdf-editor/）。
// ローカル開発（vite dev）でも同じパスで動くので、リンクや fetch は import.meta.env.BASE_URL 基準で書く。
export default defineConfig({
  base: '/lab-pdf-editor/',
  build: {
    target: 'es2022',
    sourcemap: true,
    // ライセンス表示（/*! … */・@license）を配信物に残す。ソースに写したアイコン（src/ui/icons.ts）の ISC/MIT の条件
    rolldownOptions: { output: { comments: { legal: true } } },
  },
  worker: {
    format: 'es',
  },
});
