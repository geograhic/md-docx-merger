# 部署说明（Vercel 构建 + Cloudflare Worker 子路径）

目标：通过 `https://apps.endril.com/md-docx-merger/` 访问本工具。

## 架构

```
浏览器 ──► apps.endril.com/md-docx-merger/*  (Cloudflare Worker 反代)
                │  剥离 /md-docx-merger 前缀
                ▼
        <你的项目>.vercel.app/*   (Vercel 静态构建，纯前端)
```

整站是**静态站点**（无后端），构建产物在 `dist/`。

---

## 步骤 1 — Vercel 构建部署

1. 打开 https://vercel.com/new （用 GitHub 登录）。
2. **Import** 仓库 `geograhic/md-docx-merger`。
3. 框架预设选 **Vite**；若未自动识别，手动设置：
   - Build Command：`npm run build`
   - Output Directory：`dist`
   （仓库里已包含 `vercel.json`，Vercel 会自动采用。）
4. 点击 **Deploy**。等待构建完成，得到一个 `* .vercel.app` 地址，例如：
   `https://md-docx-merger-xxxx.vercel.app`
5. 验证：直接打开该 Vercel 地址，页面应正常显示且**样式完整**。
   - 若样式丢失（白底无样式），说明 `base` 配置错误；本仓库已固定为相对路径 `./`，正常不会出现。

---

## 步骤 2 — Cloudflare Worker 子路径反代

把 `apps.endril.com/md-docx-merger/*` 转发到上面的 Vercel 地址。

1. 打开 Cloudflare → **Workers & Pages** → **Create** → 选 **Worker** → 粘贴
   `cloudflare-worker/md-docx-merger-proxy.js` 的内容。
2. 把文件里的这一行改成你的 Vercel 地址：
   ```js
   const TARGET = 'https://__VERCEL_TARGET__.vercel.app'; // ← 改成实际 *.vercel.app 地址
   ```
3. **Deploy** Worker，得到一个 `*.workers.dev` 地址（仅用于自检，可忽略）。
4. 添加路由：Cloudflare → **Workers** → 你的 Worker → **Settings → Routes** → 添加：
   - Route：`apps.endril.com/md-docx-merger/*`
   - Zone：`endril.com`
5. （若你已有统一的 `apps.endril.com` 代理 Worker，则只需在该 Worker 里加一条
   `/md-docx-merger/*` → Vercel 的转发规则，无需新建 Worker。）

---

## 步骤 3 — 访问并验证

1. 打开 **`https://apps.endril.com/md-docx-merger/`**（注意末尾斜杠）。
2. 验证要点：
   - 页面样式完整、可正常操作；
   - 访问不带斜杠的 `https://apps.endril.com/md-docx-merger` 应 **自动 308 重定向**到带斜杠地址（Worker 已内置该逻辑）；
   - 在 Vercel 根域名下直接打开也应样式正常（验证相对路径 `base: './'` 生效）。
3. 实际用几个 Markdown / Word 文件跑一遍 4 种模式，确认结果可下载。

---

## 常见问题

- **子路径打开后页面无样式**：检查 Cloudflare 是否正确转发了 `/md-docx-merger/assets/*`；并确认 Vercel 构建用的是相对 `base`（本仓库已固定）。
- **Worker 部署后 404**：确认 Route 通配符为 `apps.endril.com/md-docx-merger/*`，且 Zone 选对。
- **想更新代码**：在本仓库推送新提交，Vercel 会自动重新构建部署；Worker 无需改动（除非换了 Vercel 地址）。

## 本地预览生产构建

```bash
npm run build
npm run preview     # http://localhost:4173
```
