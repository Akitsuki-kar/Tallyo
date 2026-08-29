/**
 * 生成唯一 ID：优先使用 Web Crypto（UUID），降级到时间戳+随机串。
 */
export function genId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 种子房源「我的家」的固定 ID（合法 UUID 格式）。
 *
 * 为什么必须固定：房源、水电单价、预算都按 premiseId 归并同步。
 * 若每台设备首次启动都用随机 id 创建「我的家」，则多端默认房源 id 互不相同，
 * 价格/预算/读数将永远挂在各自的房源下、无法跨端合并（表现即「价格没同步」）。
 * 固定 id 保证所有设备首次启动的默认房源是同一个实体，跨端数据可正确合并。
 */
export const HOME_PREMISE_ID = '00000000-0000-0000-0000-000000000001';

