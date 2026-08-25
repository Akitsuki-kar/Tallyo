# WebDAV 同步设置指南（坚果云）

「水电动账」通过 WebDAV 把数据同步到坚果云，实现多设备共享一份账单数据。

本文档说明如何获取应用密码、填写地址，以及**为什么必须用同源反向代理**。

---

## 1. 生成坚果云「应用密码」

坚果云**不支持**用账号登录密码直接做 WebDAV 鉴权，必须使用专门的「应用密码」。

1. 登录网页版坚果云：<https://www.jianguoyun.com>
2. 右上角头像 → **账户信息** → **安全选项**
3. 找到「**第三方应用管理**」→ 点击「**添加应用**」
4. 应用名称随便填（如 `shuidian-dongzhang`），生成后复制那一串**应用密码**
5. 在 App 的「WebDAV 同步」里：
   - **用户名** = 你的坚果云登录邮箱
   - **应用密码** = 上一步生成的那串（**不是**账号登录密码）

> 应用密码只显示一次，请妥善保存。可在同一页面随时「移除应用」吊销。

---

## 2. WebDAV 地址填什么

App 始终以**同源**方式访问 WebDAV：地址填**相对路径** `/dav/...`，
浏览器发请求到「当前站点域名 + /dav/...」，由部署在同一域名下的反向代理转发到坚果云。

- **开发环境（本机 `npm run dev`）**：直接填
  ```
  /dav/水电动账
  ```
  App 通过 Vite 开发代理（`vite.config.ts` 的 `server.proxy`，同源 `localhost`）转发到
  `https://dav.jianguoyun.com/dav/水电动账`，规避浏览器 CORS 限制。
  目录名可自定义（ASCII 或中文均可，会自动编码）。

- **生产环境（已部署的站点）**：同样填**同源相对路径**
  ```
  /dav/水电动账
  ```
  由你的站点（与前端**同一域名**）上的反向代理把 `/dav/` 转发到坚果云（见第 4 节）。

> ⚠️ **不要填跨域绝对地址**（如 `https://sync.other-domain.com/dav/...`）。
> 本应用的 CSP 设置为 `connect-src 'self'`，跨域请求会被浏览器安全策略直接拦截，
> 即使反代配置完全正确也无法连通。保持「同源 + 相对路径」即可同时满足 CSP 与 CORS。

实际数据文件会存放在：`<同源站点>/dav/水电动账/data.json`，目录会在首次同步时自动创建。

---

## 3. 为什么浏览器直连坚果云会 CORS 失败，以及为什么必须同源反代

浏览器的同源策略要求跨域请求（网页域名 ≠ `dav.jianguoyun.com`）的响应必须携带
`Access-Control-Allow-Origin` 等 CORS 头。**坚果云的 WebDAV 端点不返回任何 CORS 头**，
因此浏览器在发送 `PROPFIND` / `PUT` 等请求前会被拦截，表现为「网络错误 / Failed to fetch」。

解决方式：

1. **开发期**：用 Vite 代理（地址填 `/dav/...`），请求走同源的本地服务器转发，不涉及浏览器跨域。
2. **生产期**：在你自己的服务器上，于**与前端相同的域名**下放一个反向代理（如 `/dav/`），
   由代理去访问坚果云。因为请求对浏览器而言仍是**同源**（`你的域名/dav/...`），
   既不需要 CORS 头，也不受 CSP `connect-src 'self'` 限制。跨域发生在「你的服务器 → 坚果云」之间，
   对浏览器完全透明。

---

## 4. 生产部署：同源 Nginx 反向代理示例

在承载前端静态资源的**同一个 `server` 块**里，新增 `/dav/` 的 location 转发到坚果云：

```nginx
server {
    listen 443 ssl;
    server_name your-app-domain.com;   # 与前端站点同域名

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # ── 前端静态资源（Vite 构建产物） ──
    root /var/www/sdb/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }

    # ── WebDAV 同源反代：浏览器请求 your-app-domain.com/dav/... 时转发到坚果云 ──
    location /dav/ {
        # 透传授权头，由代理用坚果云账号 + 应用密码去请求
        proxy_pass https://dav.jianguoyun.com/dav/;
        proxy_set_header Host dav.jianguoyun.com;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Content-Type $content_type;
        proxy_set_header Depth $http_depth;

        # 同源下浏览器不要求 CORS 头；若未来把反代拆到独立子域，
        # 则需在此补 CORS 头并相应放宽 CSP（connect-src 增加该域名）。
    }
}
```

要点：
- 反代必须与**前端同域名**（`server_name your-app-domain.com`），App 才能用同源相对路径 `/dav/...` 访问。
- `proxy_pass` 指向 `https://dav.jianguoyun.com/dav/`，并务必透传 `Authorization`
  （即 App 填的邮箱 + 应用密码的 Basic Auth）。
- `Depth` 是 `PROPFIND` 必需的请求头，需透传。
- WebDAV 用到 `PROPFIND` / `MKCOL` / `PUT` / `GET` 等扩展方法，`proxy_pass` 默认允许，无需额外放行。

---

## 5. 坚果云频率限制提醒

坚果云对 WebDAV 有较严格的频率限制（频繁请求可能触发限流或临时封禁）。本 App 已做如下保护：

- 变更同步采用 **30 秒防抖**，且两次同步之间至少间隔 **60 秒**（节流）。
- 同步失败采用**指数退避重试**（最多 3 次）后停止，避免死循环刷请求。
- 同一时刻只有一个同步任务（本地锁，5 分钟超时兜底）。

建议你：
- 不要手动高频点击「立即同步」。
- 多设备不要在同一秒同时触发大量写入。
- 若遇到持续同步失败，先检查应用密码是否失效、目录是否存在，再参考本指南核对代理配置。
