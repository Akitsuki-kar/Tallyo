/**
 * 核心纯函数测试（readingChain + merge）
 *
 * 编译方式：npx esbuild scripts/test-pure-functions.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=scripts/_test-out.mjs
 * 运行方式：node scripts/_test-out.mjs
 * 运行后删除临时文件。
 */
import { findPreviousReading, relinkChain } from '@/utils/readingChain';
import { resolveLWW, mergeEntities, mergeSnapshotDetailed } from '@/sync/merge';
import { monthlyUsage, monthReadings } from '@/utils/billing';
import { calcTieredCost, calcCost, defaultPriceConfig } from '@/utils/pricing';
import { isQuotaError } from '@/db/guard';
import { encryptKeyWithPassphrase, decryptKeyWithPassphrase } from '@/sync/crypto';
import type { Reading, Bill, Premise, PriceRecord, Budget, Settings } from '@/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

// ─── findPreviousReading 测试 ───

function makeReading(overrides: Partial<Reading>): Reading {
  return {
    id: 'r1',
    premiseId: 'p1',
    type: 'electricity',
    reading: 100,
    previousReading: null,
    date: '2024-01-15',
    createdAt: '2024-01-15T08:00:00Z',
    syncVersion: 1,
    isDeleted: false,
    ...overrides,
  };
}

// 基本查找：取 date 严格早于目标的最近一条
{
  const items: Reading[] = [
    makeReading({ id: 'a', date: '2024-01-10', reading: 50 }),
    makeReading({ id: 'b', date: '2024-01-20', reading: 80 }),
    makeReading({ id: 'c', date: '2024-01-15', reading: 60 }),
  ];
  const prev = findPreviousReading(items, 'p1', 'electricity', '2024-01-18');
  assert(prev?.id === 'c', 'findPreviousReading: 应取 date < target 的最近一条 (c, 01-15)');
}

// 无前驱（链首）
{
  const items: Reading[] = [
    makeReading({ id: 'a', date: '2024-01-10', reading: 50 }),
  ];
  const prev = findPreviousReading(items, 'p1', 'electricity', '2024-01-09');
  assert(prev === undefined, 'findPreviousReading: 无前驱时返回 undefined');
}

// 同日期补录：date 相同不算「严格早于」
{
  const items: Reading[] = [
    makeReading({ id: 'a', date: '2024-01-15', createdAt: '2024-01-15T08:00:00Z', reading: 50 }),
    makeReading({ id: 'b', date: '2024-01-15', createdAt: '2024-01-15T10:00:00Z', reading: 60 }),
  ];
  // targetDate = 2024-01-15，两条 date 相同 → 都不算「严格早于」→ undefined
  const prev = findPreviousReading(items, 'p1', 'electricity', '2024-01-15');
  assert(prev === undefined, 'findPreviousReading: date 相同不算严格早于');
}

// 排除自身
{
  const items: Reading[] = [
    makeReading({ id: 'a', date: '2024-01-10', reading: 50 }),
    makeReading({ id: 'b', date: '2024-01-12', reading: 60 }),
  ];
  const prev = findPreviousReading(items, 'p1', 'electricity', '2024-01-12', 'b');
  assert(prev?.id === 'a', 'findPreviousReading: excludeId 排除自身后取前一条');
}

// 不同房源不命中
{
  const items: Reading[] = [
    makeReading({ id: 'a', premiseId: 'p2', date: '2024-01-10', reading: 50 }),
  ];
  const prev = findPreviousReading(items, 'p1', 'electricity', '2024-01-15');
  assert(prev === undefined, 'findPreviousReading: 不同房源不命中');
}

// 软删跳过
{
  const items: Reading[] = [
    makeReading({ id: 'a', date: '2024-01-10', isDeleted: true, reading: 50 }),
    makeReading({ id: 'b', date: '2024-01-12', reading: 60 }),
  ];
  const prev = findPreviousReading(items, 'p1', 'electricity', '2024-01-15');
  assert(prev?.id === 'b', 'findPreviousReading: 跳过软删记录');
}

// ─── relinkChain 测试 ───

// 基本链重建
{
  const items: Reading[] = [
    makeReading({ id: 'c', date: '2024-01-20', reading: 90, previousReading: 60 }),
    makeReading({ id: 'a', date: '2024-01-10', reading: 50, previousReading: null }),
    makeReading({ id: 'b', date: '2024-01-15', reading: 60, previousReading: 50 }),
  ];
  const changed = relinkChain(items, 'p1', 'electricity');
  // 链已正确，应无变更
  assert(changed.length === 0, 'relinkChain: 已正确的链无变更');
}

// 链需要修正
{
  const items: Reading[] = [
    makeReading({ id: 'b', date: '2024-01-15', reading: 60, previousReading: 999 }), // 错误
    makeReading({ id: 'a', date: '2024-01-10', reading: 50, previousReading: null }),
  ];
  const changed = relinkChain(items, 'p1', 'electricity');
  assert(changed.length === 1, 'relinkChain: 修正错误的前驱');
  assert(changed[0]?.id === 'b', 'relinkChain: 变更项为 b');
  assert(changed[0]?.previousReading === 50, 'relinkChain: 前驱修正为 50');
}

// 同日期按 createdAt 排序
{
  const items: Reading[] = [
    makeReading({ id: 'b', date: '2024-01-15', createdAt: '2024-01-15T10:00:00Z', reading: 60, previousReading: null }),
    makeReading({ id: 'a', date: '2024-01-15', createdAt: '2024-01-15T08:00:00Z', reading: 50, previousReading: null }),
  ];
  const changed = relinkChain(items, 'p1', 'electricity');
  // a (08:00) 在前，b (10:00) 在后 → b.previousReading = 50
  const bChanged = changed.find((r) => r.id === 'b');
  assert(bChanged?.previousReading === 50, 'relinkChain: 同日期按 createdAt 排序');
}

// ─── resolveLWW 测试 ───

// syncVersion 高者胜
{
  const local = { syncVersion: 5, updatedAt: '2024-01-01', isDeleted: false };
  const remote = { syncVersion: 3, updatedAt: '2024-01-02', isDeleted: false };
  assert(resolveLWW(local, remote) === 'local', 'resolveLWW: syncVersion 高者胜');
}

// syncVersion 相等 → updatedAt 新者胜
{
  const local = { syncVersion: 5, updatedAt: '2024-01-01', isDeleted: false };
  const remote = { syncVersion: 5, updatedAt: '2024-01-02', isDeleted: false };
  assert(resolveLWW(local, remote) === 'remote', 'resolveLWW: 版本相等时 updatedAt 新者胜');
}

// 全等 → equal
{
  const local = { syncVersion: 5, updatedAt: '2024-01-01', isDeleted: false };
  const remote = { syncVersion: 5, updatedAt: '2024-01-01', isDeleted: false };
  assert(resolveLWW(local, remote) === 'equal', 'resolveLWW: 全等返回 equal');
}

// 一方删除、一方有值 → syncVersion 高者胜
{
  const local = { syncVersion: 5, updatedAt: '2024-01-01', isDeleted: true };
  const remote = { syncVersion: 3, updatedAt: '2024-01-02', isDeleted: false };
  assert(resolveLWW(local, remote) === 'local', 'resolveLWW: 删除方版本高 → local 胜（墓碑）');
}

// 双方都删除 → equal
{
  const local = { syncVersion: 5, updatedAt: '2024-01-01', isDeleted: true };
  const remote = { syncVersion: 5, updatedAt: '2024-01-01', isDeleted: true };
  assert(resolveLWW(local, remote) === 'equal', 'resolveLWW: 双方都删除 → equal');
}

// ─── mergeEntities 测试 ───

// 仅本地有 → pushed
{
  const local = [{ id: 'a', syncVersion: 1, updatedAt: '2024-01-01', isDeleted: false }];
  const remote: typeof local = [];
  const { merged, pushed, pulled, conflicts } = mergeEntities(local, remote);
  assert(merged.length === 1, 'mergeEntities: 仅本地有 → merged 1');
  assert(pushed.length === 1, 'mergeEntities: 仅本地有 → pushed 1');
  assert(pulled.length === 0, 'mergeEntities: 仅本地有 → pulled 0');
  assert(conflicts === 0, 'mergeEntities: 仅本地有 → conflicts 0');
}

// 仅远端有 → pulled
{
  const local: { id: string; syncVersion: number; updatedAt: string; isDeleted: boolean }[] = [];
  const remote = [{ id: 'b', syncVersion: 1, updatedAt: '2024-01-01', isDeleted: false }];
  const { merged, pushed, pulled, conflicts } = mergeEntities(local, remote);
  assert(merged.length === 1, 'mergeEntities: 仅远端有 → merged 1');
  assert(pushed.length === 0, 'mergeEntities: 仅远端有 → pushed 0');
  assert(pulled.length === 1, 'mergeEntities: 仅远端有 → pulled 1');
  assert(conflicts === 0, 'mergeEntities: 仅远端有 → conflicts 0');
}

// 双方有且相等 → equal, no conflict
{
  const local = [{ id: 'a', syncVersion: 1, updatedAt: '2024-01-01', isDeleted: false }];
  const remote = [{ id: 'a', syncVersion: 1, updatedAt: '2024-01-01', isDeleted: false }];
  const { merged, pushed, pulled, conflicts } = mergeEntities(local, remote);
  assert(merged.length === 1, 'mergeEntities: 全等 → merged 1');
  assert(pushed.length === 0, 'mergeEntities: 全等 → pushed 0');
  assert(pulled.length === 0, 'mergeEntities: 全等 → pulled 0');
  assert(conflicts === 0, 'mergeEntities: 全等 → conflicts 0');
}

// prices 用 premiseId 作主键
{
  const local = [{ premiseId: 'p1', syncVersion: 1, updatedAt: '2024-01-01', isDeleted: false }];
  const remote = [{ premiseId: 'p1', syncVersion: 2, updatedAt: '2024-01-02', isDeleted: false }];
  const { pulled } = mergeEntities(local, remote, (p) => p.premiseId);
  assert(pulled.length === 1, 'mergeEntities: prices 主键 premiseId');
}

// ─── mergeSnapshotDetailed 测试 ───

// 完整合并
{
  const local = {
    schemaVersion: 1,
    exportedAt: '2024-01-01',
    readings: [
      makeReading({ id: 'r1', syncVersion: 1, updatedAt: '2024-01-01' }),
    ],
    bills: [],
    premises: [{ id: 'p1', name: '家', createdAt: '', updatedAt: '2024-01-01', syncVersion: 1, isDeleted: false }],
    prices: [{ premiseId: 'p1', config: { mode: 'flat' as const, flat: { electricity: 0.5, water: 3 }, tiers: { electricity: [], water: [] } }, updatedAt: '2024-01-01', syncVersion: 1, isDeleted: false }],
    budgets: [{ id: 'b1', premiseId: 'p1', mode: 'amount' as const, electricityLimit: 100, waterLimit: 50, createdAt: '', updatedAt: '2024-01-01', syncVersion: 1, isDeleted: false }],
  };
  const remote = {
    schemaVersion: 1,
    exportedAt: '2024-01-02',
    readings: [
      makeReading({ id: 'r2', syncVersion: 1, updatedAt: '2024-01-02' }),
    ],
    bills: [],
    premises: [],
    prices: [],
    budgets: [],
  };
  const { merged, pulled, stats } = mergeSnapshotDetailed(local, remote);
  assert(merged.readings.length === 2, 'mergeSnapshot: 合并后 readings 2 条');
  assert(pulled.readings?.length === 1, 'mergeSnapshot: pulled readings 1 条');
  assert(stats.pulled === 1, 'mergeSnapshot: stats.pulled = 1');
}

// ─── monthlyUsage 测试（P1-1：月内多条读数不再少计） ───

// 单条读数：月末 − 月初基准，与原行为一致
{
  const items: Reading[] = [
    makeReading({ id: 'dec', date: '2024-01-31', reading: 80 }),
    makeReading({ id: 'jan', date: '2024-02-15', reading: 120 }),
  ];
  assert(monthlyUsage(items, 'p1', 'electricity', '2024-02') === 40, 'monthlyUsage: 单条读数 = 120-80 = 40');
}

// 月内多条读数：取净额，不丢中间用量
{
  const items: Reading[] = [
    makeReading({ id: 'dec', date: '2024-01-31', reading: 80 }),
    makeReading({ id: 'r1', date: '2024-02-05', reading: 100 }),
    makeReading({ id: 'r2', date: '2024-02-15', reading: 120 }),
    makeReading({ id: 'r3', date: '2024-02-25', reading: 150 }),
  ];
  // 旧实现只取末条单差：150-120=30，少计 20+30；新实现：150-80=70
  assert(monthlyUsage(items, 'p1', 'electricity', '2024-02') === 70, 'monthlyUsage: 月内多条 = 150-80 = 70（不丢 20+30）');
}

// 该月首条即历史首条：无更早基准 → 0
{
  const items: Reading[] = [
    makeReading({ id: 'only', date: '2024-02-15', reading: 120 }),
  ];
  assert(monthlyUsage(items, 'p1', 'electricity', '2024-02') === 0, 'monthlyUsage: 无更早基准 → 0');
}

// 表复位导致负净额 → 钳为 0（账单用量不应为负）
{
  const items: Reading[] = [
    makeReading({ id: 'dec', date: '2024-01-31', reading: 200 }),
    makeReading({ id: 'jan', date: '2024-02-15', reading: 80 }),
  ];
  assert(monthlyUsage(items, 'p1', 'electricity', '2024-02') === 0, 'monthlyUsage: 负净额钳为 0');
}

// 水 / 电按类型独立计算
{
  const items: Reading[] = [
    makeReading({ id: 'e0', type: 'electricity', date: '2024-01-31', reading: 80 }),
    makeReading({ id: 'e1', type: 'electricity', date: '2024-02-20', reading: 130 }),
    makeReading({ id: 'w0', type: 'water', date: '2024-01-31', reading: 10 }),
    makeReading({ id: 'w1', type: 'water', date: '2024-02-20', reading: 25 }),
  ];
  assert(monthlyUsage(items, 'p1', 'electricity', '2024-02') === 50, 'monthlyUsage: 电独立 130-80 = 50');
  assert(monthlyUsage(items, 'p1', 'water', '2024-02') === 15, 'monthlyUsage: 水独立 25-10 = 15');
}

// 软删读数不参与计算
{
  const items: Reading[] = [
    makeReading({ id: 'dec', date: '2024-01-31', reading: 80 }),
    makeReading({ id: 'r1', date: '2024-02-05', reading: 100 }),
    makeReading({ id: 'r2', date: '2024-02-15', reading: 120, isDeleted: true }),
    makeReading({ id: 'r3', date: '2024-02-25', reading: 150 }),
  ];
  // 软删的 r2 被跳过，仍按净用量 150-80 = 70
  assert(monthlyUsage(items, 'p1', 'electricity', '2024-02') === 70, 'monthlyUsage: 跳过软删读数');
}

// ─── db/guard：配额错误识别（高优②） ───
function testGuardQuota(): void {
  function makeErr(name?: string, code?: number): unknown {
    const e = new Error('x');
    if (name) e.name = name;
    if (code !== undefined) (e as { code?: number }).code = code;
    return e;
  }
  assert(isQuotaError(makeErr('QuotaExceededError')), 'isQuotaError: QuotaExceededError');
  assert(isQuotaError(makeErr('NS_ERROR_DOM_QUOTA_REACHED')), 'isQuotaError: Firefox 命名');
  assert(isQuotaError(makeErr(undefined, 22)), 'isQuotaError: Firefox code 22');
  assert(isQuotaError(makeErr(undefined, 1014)), 'isQuotaError: code 1014');
  assert(!isQuotaError(makeErr('SomethingElse')), 'isQuotaError: 非配额错误不误判');
  assert(!isQuotaError(new Error('plain')), 'isQuotaError: 普通错误忽略');
  assert(!isQuotaError('not an error'), 'isQuotaError: 非 Error 对象忽略');
  assert(!isQuotaError(null), 'isQuotaError: null 忽略');
}

testGuardQuota();

// ─── crypto：设备密钥口令加密备份（体验⑭） ───
async function testKeyBackup(): Promise<void> {
  // 32 字节密钥的 base64（测试向量，非真实密钥）。用 Buffer 生成 32 字节的合法 base64。
  const rawKey = Buffer.from('A'.repeat(32)).toString('base64');
  const pass = 'strong-passphrase-2026';

  const json = await encryptKeyWithPassphrase(rawKey, pass);
  const parsed = JSON.parse(json);
  assert(parsed.v === 1 && !!parsed.salt && !!parsed.iv && !!parsed.ct, 'keyBackup: 导出结构含 v/salt/iv/ct');

  // 正确口令可还原
  const recovered = await decryptKeyWithPassphrase(json, pass);
  assert(recovered === rawKey, 'keyBackup: 正确口令还原一致');

  // 错误口令抛错（不可还原）
  let threw = false;
  try {
    await decryptKeyWithPassphrase(json, 'wrong-pass');
  } catch {
    threw = true;
  }
  assert(threw, 'keyBackup: 错误口令抛错');

  // 空口令抛错
  let threwEmpty = false;
  try {
    await encryptKeyWithPassphrase(rawKey, '');
  } catch {
    threwEmpty = true;
  }
  assert(threwEmpty, 'keyBackup: 空口令抛错');

  // 篡改密文抛错
  const tampered = json.replace(/"ct":"[^"]+"/, '"ct":"AAAA"');
  let threwTamper = false;
  try {
    await decryptKeyWithPassphrase(tampered, pass);
  } catch {
    threwTamper = true;
  }
  assert(threwTamper, 'keyBackup: 篡改密文抛错');
}

await testKeyBackup();

// ─── webdavClient 回归：propfind 在「无 etag」时也必须报告 exists（防多端覆盖 bug）───
// 背景：sync 曾以 `meta.exists && remoteEtag` 判定是否拉取远端；若服务不返回 getetag，
// 远端会被当成空快照 → 本地直接覆盖远端、多端数据互相覆盖丢失。
// 本条锁定：207 响应即使无 getetag，exists 也必须为 true。

// 极简 XML 文档 mock：按标签返回（ns 忽略；getElementsByTagNameNS 由 webdavClient 以 'DAV:' 调用）
function xmlDoc(tags: Record<string, string>): { getElementsByTagNameNS: (ns: string, tag: string) => ArrayLike<{ textContent: string }> } {
  return {
    getElementsByTagNameNS: (_ns: string, tag: string) =>
      tag in tags ? [{ textContent: tags[tag] }] : [],
  };
}

// 构造 mock fetch：按 pathname 返回预设 Response
function mockFetchOnce(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): typeof fetch {
  const doFetch = (async () => {
    return new Response(body, { status, headers });
  }) as unknown as typeof fetch;
  return doFetch;
}

{
  const { createWebdavClient } = await import('@/sync/webdavClient');
  const cred = { baseUrl: 'https://dav.example.com/', username: 'u', password: 'p' };

  // 1) 207 且 XML 无 getetag → exists=true、etag=undefined（本次 bug 的回归防线）
  {
    const noEtagXml =
      '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/data.json</D:href><D:propstat><D:prop><D:getcontentlength>42</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>';
    const client = createWebdavClient(cred, {
      fetchImpl: mockFetchOnce(207, noEtagXml),
      parseXml: () =>
        xmlDoc({ getcontentlength: '42' }) as unknown as import('@/sync/webdavClient').XmlDocumentLike,
    });
    const meta = await client.propfind('data.json');
    assert(meta.exists === true, 'propfind 无 etag 时 exists 必须为 true（防覆盖）');
    assert(meta.etag === undefined, 'propfind 无 etag 时 etag 为 undefined');
    assert(meta.size === 42, 'propfind 仍能解析 getcontentlength');
  }

  // 2) 207 且 XML 含 getetag → etag 正常解析
  {
    const withEtagXml =
      '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/data.json</D:href><D:propstat><D:prop><D:getetag>"abc123"</D:getetag><D:getcontentlength>42</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>';
    const client = createWebdavClient(cred, {
      fetchImpl: mockFetchOnce(207, withEtagXml),
      parseXml: () => {
        const doc = {
          getElementsByTagNameNS: (ns: string, tag: string) => {
            if (tag === 'getetag') return [{ textContent: '"abc123"' }];
            if (tag === 'getcontentlength') return [{ textContent: '42' }];
            return [];
          },
        };
        return doc as unknown as import('@/sync/webdavClient').XmlDocumentLike;
      },
    });
    const meta = await client.propfind('data.json');
    assert(meta.exists === true, 'propfind 有 etag 时 exists 为 true');
    assert(meta.etag === '"abc123"', 'propfind 解析出 etag');
  }

  // 3) 404 → exists=false（远端无文件，sync 应走空快照分支）
  {
    const client = createWebdavClient(cred, {
      fetchImpl: mockFetchOnce(404, ''),
      parseXml: () => xmlDoc({}) as unknown as import('@/sync/webdavClient').XmlDocumentLike,
    });
    const meta = await client.propfind('data.json');
    assert(meta.exists === false, 'propfind 404 时 exists=false');
  }
}

// ─── 阶梯计价测试 ───
// 重点：calcTieredCost 必须对「档位填写顺序」不敏感。
// 单价面板允许在任意位置插入档位、任意修改上限，用户填出的顺序不保证升序；
// 若不归一化，乱序档位会被 range<=0 静默跳过、或首个 null 档吃掉全部用量，
// 产出一份「看起来正常但金额不对」的账单。

function near(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 0.005, `${message}（实测 ${actual}，期望 ${expected}）`);
}

// 基准：升序档位 [≤216 @0.56, ≤480 @0.61, 及以上 @0.86]，用量 300
// = 216×0.56 + 84×0.61 = 120.96 + 51.24 = 172.20
{
  const tiers = [
    { upTo: 216, price: 0.56 },
    { upTo: 480, price: 0.61 },
    { upTo: null, price: 0.86 },
  ];
  near(calcTieredCost(300, tiers), 172.2, 'calcTieredCost: 升序档位基准');
}

// 回归：同一组档位打乱顺序，结果必须与升序一致
{
  const shuffled = [
    { upTo: null, price: 0.86 },
    { upTo: 480, price: 0.61 },
    { upTo: 216, price: 0.56 },
  ];
  near(calcTieredCost(300, shuffled), 172.2, 'calcTieredCost: 乱序档位须与升序等价（回归）');
}

// 回归：null（及以上）出现在中间时，不能被提前吃掉全部用量
{
  const nullFirst = [
    { upTo: null, price: 0.86 },
    { upTo: 216, price: 0.56 },
  ];
  // 归一化后 = [≤216 @0.56, 及以上 @0.86] → 216×0.56 + 84×0.86 = 120.96 + 72.24 = 193.20
  near(calcTieredCost(300, nullFirst), 193.2, 'calcTieredCost: null 档须排到最后（回归）');
}

// 边界与脏数据
{
  const tiers = [
    { upTo: 216, price: 0.56 },
    { upTo: null, price: 0.86 },
  ];
  near(calcTieredCost(0, tiers), 0, 'calcTieredCost: 用量 0 → 0');
  near(calcTieredCost(-5, tiers), 0, 'calcTieredCost: 负用量 → 0');
  near(calcTieredCost(300, []), 0, 'calcTieredCost: 空档位 → 0');
  // 脏数据（NaN 单价）应被丢弃而非污染出 NaN 账单
  const dirty = [
    { upTo: 100, price: Number.NaN },
    { upTo: null, price: 0.86 },
  ];
  near(calcTieredCost(50, dirty), 43, 'calcTieredCost: NaN 单价档位被丢弃');
  assert(Number.isFinite(calcTieredCost(50, dirty)), 'calcTieredCost: 脏数据不得产出 NaN');
}

// calcCost：固定单价 / 阶梯两条路径
{
  const flat = defaultPriceConfig();
  near(calcCost('electricity', 100, flat), 56, 'calcCost: 固定单价 100×0.56');
  near(calcCost('water', 10, flat), 35, 'calcCost: 固定单价 10×3.5');
  near(calcCost('electricity', 0, flat), 0, 'calcCost: 用量 0 → 0');

  const tiered = { ...flat, mode: 'tiered' as const };
  // 电阶梯默认 [≤216 @0.56, ≤480 @0.61, 及以上 @0.86]，用量 300 → 172.20
  near(calcCost('electricity', 300, tiered), 172.2, 'calcCost: 阶梯计价走 calcTieredCost');
  // 水阶梯默认 [≤180 @3.5, 及以上 @4.8]，用量 200 → 180×3.5 + 20×4.8 = 630 + 96 = 726
  near(calcCost('water', 200, tiered), 726, 'calcCost: 水阶梯独立生效');
}

// ─── 结果汇总 ───
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
