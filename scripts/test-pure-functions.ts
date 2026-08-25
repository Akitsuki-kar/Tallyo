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

// ─── 结果汇总 ───
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
