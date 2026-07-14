// Cloudflare Worker：将 apps.endril.com/md-docx-merger/* 反向代理到 Vercel 部署
// 部署步骤：
//   1. Cloudflare → Workers & Pages → 创建 Worker，粘贴本文件
//   2. 把下方 TARGET 改成你的 Vercel 地址（形如 https://md-docx-merger-xxx.vercel.app）
//   3. 添加路由：apps.endril.com/md-docx-merger/*
// 注意：无斜杠入口 /md-docx-merger 会 308 重定向到 /md-docx-merger/，保证相对路径资源正确解析。
const TARGET = 'https://__VERCEL_TARGET__.vercel.app'; // ← 改成实际 *.vercel.app 地址
const PREFIX = '/md-docx-merger';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;

    // 无斜杠入口 → 补斜杠重定向（保证相对路径资源解析正确）
    if (pathname === PREFIX) {
      return Response.redirect(url.origin + PREFIX + '/', 308);
    }

    // 剥离前缀，转发给 Vercel
    let targetPath;
    if (pathname.startsWith(PREFIX + '/')) {
      targetPath = pathname.slice(PREFIX.length);
    } else if (pathname.startsWith(PREFIX)) {
      targetPath = '/';
    } else {
      targetPath = pathname;
    }
    if (!targetPath || targetPath === '') targetPath = '/';

    const targetUrl = TARGET + targetPath + url.search;
    return fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
    });
  },
};
