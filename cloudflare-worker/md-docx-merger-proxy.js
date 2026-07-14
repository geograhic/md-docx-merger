// Cloudflare Worker（经典 Service Worker 格式）：将 apps.endril.com/md-docx-merger/* 反向代理到 Vercel 部署
// 已通过 Cloudflare API 自动上传并绑定路由 apps.endril.com/md-docx-merger*
// 注意：无斜杠入口 /md-docx-merger 会 308 重定向到 /md-docx-merger/，保证相对路径资源正确解析。
const TARGET = 'https://md-docx-merger.vercel.app'; // Vercel 生产地址（已部署）
const PREFIX = '/md-docx-merger';

async function handle(request) {
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

  // 关键：转发时必须去掉原始 host（apps.endril.com），否则 Vercel 会按 host 误路由；
  // 同时清掉 Cloudflare 注入的 cf-* 头，避免被上游当做异常请求。
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-ray');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-request-id');
  headers.delete('cf-visitor');

  const targetUrl = TARGET + targetPath + url.search;
  return fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'follow',
  });
}

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});
