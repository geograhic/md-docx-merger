import { defineConfig } from 'vite';

// 本地桌面应用 → Web 通用模板
// 关键：base 用相对路径 './'，这样直接访问 Vercel 根域名 和 通过 apps.endril.com/md-docx-merger 子路径访问都能正确加载样式/脚本。
// 子路径场景依赖 Cloudflare Worker 对无斜杠入口做 308 重定向兜底。
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // 应用本身不大，但第三方库打包后可能触发体积警告，放宽阈值避免误报
    chunkSizeWarningLimit: 1500,
  },
});
