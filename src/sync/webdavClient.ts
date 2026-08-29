/**
 * WebDAV 客户端（纯网络层，不依赖 store / Vue）。
 * 支持相对路径（如 /dav/我的应用/，开发走 Vite 代理）与绝对 URL（自建反代 / Tauri 原生 HTTP）两种 baseUrl。
 * 通过 Basic Auth 鉴权；propfind 用命名空间安全的 getElementsByTagNameNS 解析；
 * put 支持 If-Match 乐观并发；所有请求带超时（AbortController）。
 * 传输层：Tauri 原生壳自动切换 tauri-plugin-http 的原生 fetch（绕开 WebView CORS，见 @/native/httpTransport）。
 */
import { bytesToBase64 } from '@/utils/base64';
import { SdbError } from '@/sync/errors';
import { ERROR_CODES } from '@/utils/errorCodes';
import { logger } from '@/utils/logger';
import { isTauriShell } from '@/utils/platform';
import { getWebFetch } from '@/native/httpTransport';

export interface WebdavCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

export interface RemoteFileMeta {
  exists: boolean;
  etag?: string;
  lastModified?: string;
  size?: number;
}

/** 极简 XML 文档接口，兼容浏览器 DOMParser 与测试注入的极简 parser */
export interface XmlElementLike {
  textContent: string | null;
}
export interface XmlDocumentLike {
  getElementsByTagNameNS(namespace: string, localName: string): ArrayLike<XmlElementLike>;
}

export interface WebdavClientOptions {
  timeoutMs?: number;
  /** 可注入的 XML 解析器（默认浏览器 DOMParser，便于 node 测试注入） */
  parseXml?: (xml: string) => XmlDocumentLike;
  /** 可注入的 fetch 实现（默认按运行环境自动选择：Tauri 原生 HTTP / 浏览器 fetch，便于 node 测试注入） */
  fetchImpl?: typeof fetch;
}

export interface WebdavClient {
  mkcol(path: string): Promise<void>;
  propfind(path: string): Promise<RemoteFileMeta>;
  get(path: string): Promise<string>;
  put(path: string, body: string, etag?: string): Promise<string | undefined>;
}

const DEFAULT_TIMEOUT = 20_000;
/** 单次请求最大尝试次数（含首次），用于网络抖动 / 限流退避重试（高优③） */
const MAX_ATTEMPTS = 3;
/** 退避基数：第 attempt 次失败后等待 2^attempt 秒（上限 15s） */
function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 1000, 15_000);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 默认 XML 解析（浏览器环境） */
function defaultParseXml(xml: string): XmlDocumentLike {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc as unknown as XmlDocumentLike;
}

/** baseUrl 规整：确保以 / 结尾 */
function normalizeBaseUrl(base: string): string {
  const trimmed = base.trim();
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/** 路径拼接：按 / 分段 encodeURIComponent（中文/空格安全，保留 / 分隔） */
function joinPath(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const clean = path.startsWith('/') ? path.slice(1) : path;
  const segments = clean.split('/').map((seg) => (seg === '' ? '' : encodeURIComponent(seg)));
  return `${base}${segments.join('/')}`;
}

/** Basic Auth 头：先 UTF-8 编码凭据再 base64（兼容非 ASCII 用户名/密码） */
function buildAuthHeader(username: string, password: string): string {
  const utf8 = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${bytesToBase64(utf8)}`;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/><D:getlastmodified/><D:getcontentlength/></D:prop></D:propfind>`;

/** 从 multistatus XML 中提取文件元信息（命名空间安全：用 getElementsByTagNameNS） */
function extractPropfind(doc: XmlDocumentLike): RemoteFileMeta {
  const etagNode = doc.getElementsByTagNameNS('DAV:', 'getetag')[0];
  const lmNode = doc.getElementsByTagNameNS('DAV:', 'getlastmodified')[0];
  const sizeNode = doc.getElementsByTagNameNS('DAV:', 'getcontentlength')[0];
  const text = (n?: XmlElementLike): string | undefined =>
    n?.textContent ? n.textContent.trim() : undefined;
  const sizeRaw = text(sizeNode);
  return {
    exists: true,
    etag: text(etagNode),
    lastModified: text(lmNode),
    size: sizeRaw ? Number(sizeRaw) : undefined,
  };
}

export function createWebdavClient(
  cred: WebdavCredentials,
  options: WebdavClientOptions = {},
): WebdavClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const parseXml = options.parseXml ?? defaultParseXml;

  async function request(
    method: string,
    path: string,
    opts: { headers?: Record<string, string>; body?: string } = {},
    attempt = 1,
  ): Promise<Response> {
    const url = joinPath(cred.baseUrl, path);
    // Tauri 原生 fetch（reqwest）只接受绝对 URL；相对路径（/dav/...）仅适用于有同源反代的
    // Web 环境（Vite 代理 / Nginx），原生壳没有服务器可解析，提前给出可操作报错而非晦涩的原生异常。
    if (isTauriShell() && !/^https?:\/\//i.test(url)) {
      throw new SdbError(
        ERROR_CODES.SDB_WEBDAV_CONN,
        'server',
        '原生客户端请填写完整 HTTPS 地址（如 https://dav.jianguoyun.com/dav/水电动账），相对路径仅 Web 端同源反代可用',
      );
    }
    // 传输实现：测试可注入 fetchImpl；默认按环境自动选择（Tauri→原生 HTTP，Web→浏览器 fetch）
    const doFetch = options.fetchImpl ?? (await getWebFetch());
    const headers: Record<string, string> = {
      // 日志不打印任何凭据/响应体，避免泄露敏感信息
      Authorization: buildAuthHeader(cred.username, cred.password),
      ...(opts.headers ?? {}),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      logger.info('[SDB:webdav]', `${method} ${path} (attempt ${attempt}/${MAX_ATTEMPTS})`);
      const res = await doFetch(url, {
        method,
        headers,
        body: opts.body,
        signal: controller.signal,
      });
      // 可重试的瞬时错误：429 限流 / 5xx 服务端错误 → 退避后重试（最多 MAX_ATTEMPTS 次）
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        clearTimeout(timer);
        const retryAfter = Number(res.headers.get('Retry-After') || '0');
        const delay = retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
        logger.warn('[SDB:webdav]', `请求 ${method} ${path} 返回 ${res.status}，将在 ${delay}ms 后第 ${attempt + 1} 次重试`);
        await sleep(delay);
        return request(method, path, opts, attempt + 1);
      }
      if ((res.status === 429 || res.status >= 500) && attempt >= MAX_ATTEMPTS) {
        clearTimeout(timer);
        throw new SdbError(
          ERROR_CODES.SDB_SYNC_NETWORK_FAIL,
          'network',
          res.status === 429
            ? 'WebDAV 请求过于频繁（429 限流），请稍后重试'
            : `服务端错误 ${res.status}，请参考 docs/webdav-setup.md`,
        );
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      // 网络抖动 / CORS / 超时：在达到最大重试次数前退避重试，避免单次抖动导致整轮同步失败
      if (attempt < MAX_ATTEMPTS) {
        const delay = backoffMs(attempt);
        logger.warn('[SDB:webdav]', `请求 ${method} ${path} 失败，将在 ${delay}ms 后第 ${attempt + 1} 次重试`, {
          message: err instanceof Error ? err.message : String(err),
        });
        await sleep(delay);
        return request(method, path, opts, attempt + 1);
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SdbError(
          ERROR_CODES.SDB_SYNC_NETWORK_FAIL,
          'network',
          `请求超时（>${timeoutMs}ms），可能是 CORS 拦截或网络不通，请参考 docs/webdav-setup.md`,
        );
      }
      throw new SdbError(
        ERROR_CODES.SDB_SYNC_NETWORK_FAIL,
        'network',
        `网络请求失败（可能是 CORS 拦截或断网），请参考 docs/webdav-setup.md：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function mkcol(path: string): Promise<void> {
    const res = await request('MKCOL', path);
    if (res.ok || res.status === 201 || res.status === 405 || res.status === 409) return;
    if (res.status === 401 || res.status === 403)
      throw new SdbError(ERROR_CODES.SDB_SYNC_AUTH_FAIL, 'auth', 'WebDAV 认证失败（用户名或应用密码错误）');
    if (res.status >= 500)
      throw new SdbError(ERROR_CODES.SDB_SYNC_NETWORK_FAIL, 'network', `服务端错误 ${res.status}，请参考 docs/webdav-setup.md`);
    throw new SdbError(ERROR_CODES.SDB_WEBDAV_CONN, 'server', `创建目录失败：HTTP ${res.status}`);
  }

  async function propfind(path: string): Promise<RemoteFileMeta> {
    const res = await request('PROPFIND', path, {
      headers: { 'Content-Type': 'application/xml', Depth: '0' },
      body: PROPFIND_BODY,
    });
    if (res.status === 404) return { exists: false };
    if (res.status === 207) {
      const xml = await res.text();
      try {
        return extractPropfind(parseXml(xml));
      } catch {
        // 解析失败则保守认为存在（上层 GET 会拿内容）
        return { exists: true };
      }
    }
    if (res.status === 401 || res.status === 403)
      throw new SdbError(ERROR_CODES.SDB_SYNC_AUTH_FAIL, 'auth', 'WebDAV 认证失败（用户名或应用密码错误）');
    if (res.status >= 500)
      throw new SdbError(ERROR_CODES.SDB_SYNC_NETWORK_FAIL, 'network', `服务端错误 ${res.status}，请参考 docs/webdav-setup.md`);
    throw new SdbError(ERROR_CODES.SDB_WEBDAV_CONN, 'server', `查询文件失败：HTTP ${res.status}`);
  }

  async function get(path: string): Promise<string> {
    const res = await request('GET', path);
    if (res.status === 404)
      throw new SdbError(ERROR_CODES.SDB_WEBDAV_CONN, 'notfound', '远端文件不存在');
    if (res.ok) return await res.text();
    if (res.status === 401 || res.status === 403)
      throw new SdbError(ERROR_CODES.SDB_SYNC_AUTH_FAIL, 'auth', 'WebDAV 认证失败（用户名或应用密码错误）');
    if (res.status >= 500)
      throw new SdbError(ERROR_CODES.SDB_SYNC_NETWORK_FAIL, 'network', `服务端错误 ${res.status}，请参考 docs/webdav-setup.md`);
    throw new SdbError(ERROR_CODES.SDB_WEBDAV_CONN, 'server', `读取文件失败：HTTP ${res.status}`);
  }

  async function put(path: string, body: string, etag?: string): Promise<string | undefined> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (etag) headers['If-Match'] = etag;
    const res = await request('PUT', path, { headers, body });
    if (res.status === 412)
      throw new SdbError(ERROR_CODES.SDB_WEBDAV_PUT, 'conflict', '远端数据已被其他设备修改（412），需要重新拉取合并后重试');
    if (res.ok) return res.headers.get('etag') ?? undefined;
    if (res.status === 401 || res.status === 403)
      throw new SdbError(ERROR_CODES.SDB_SYNC_AUTH_FAIL, 'auth', 'WebDAV 认证失败（用户名或应用密码错误）');
    if (res.status >= 500)
      throw new SdbError(ERROR_CODES.SDB_SYNC_NETWORK_FAIL, 'network', `服务端错误 ${res.status}，请参考 docs/webdav-setup.md`);
    throw new SdbError(ERROR_CODES.SDB_WEBDAV_PUT, 'server', `上传文件失败：HTTP ${res.status}`);
  }

  return { mkcol, propfind, get, put };
}
