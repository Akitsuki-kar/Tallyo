// SPDX-License-Identifier: Apache-2.0
/**
 * 月初账单弹层（0.1.1 功能 5）—— 判定与触发。
 *
 * 逻辑原先内联在 App.vue 的 onMounted 里，有四个致命缺陷（checkOnce 内逐条对应修复）：
 * ① 读 premises.currentPremiseId 时房源还没装载（恒为空）→ 静默跳过；
 * ② 只在 onMounted 跑一次，App 常驻跨过月末零点就不再触发；
 * ③ 严格限定「1 号」，2 号及以后打开永远不弹；
 * ④ 读到的是账单自愈重算之前的值。
 *
 * 现在：判定统一 await 启动数据就绪信号（utils/bootstrapReady），
 * 并额外监听「跨日 / 回前台」补触发，保证「月初打开 App 就能看到上月结算单」。
 */
import { ref } from 'vue';
import type { Bill } from '@/types';
import { useSettingsStore } from '@/stores/settings';
import { usePremisesStore } from '@/stores/premises';
import { useBillsStore } from '@/stores/bills';
import { dateKey, dayjs, monthKey, prevMonthKey } from '@/utils/dayjs';
import { isOnboarded } from '@/composables/useOnboarding';
import { whenDataReady } from '@/utils/bootstrapReady';
import { logger } from '@/utils/logger';

/** 防重复标记：存「已弹过的当前月」而非日期，下月自然失配，无需清理过期 key */
const POP_KEY = 'sdb:lastMonthlyBillPopMonth';
/**
 * 月初弹窗窗口（1 号起算，含）。
 * 「月初」不是「1 号」：用户 2、3 号才打开 App 也该看到结算单，
 * 否则「每月一次」的机会窗口只有 24 小时，错过就只能等下个月。
 */
const WINDOW_DAYS = 3;
/** 跨日轮询间隔：只比对日期键，真正判定每天最多一次，开销可忽略 */
const DAY_CHECK_INTERVAL_MS = 60_000;

function getLastPopMonth(): string {
  try {
    return localStorage.getItem(POP_KEY) ?? '';
  } catch {
    return '';
  }
}
function setLastPopMonth(value: string): void {
  try {
    localStorage.setItem(POP_KEY, value);
  } catch {
    /* 隐私模式等场景忽略写入失败 */
  }
}

/**
 * 这张票有没有信息量。
 * 只判 totalCost > 0 会误杀：未记房租 + 单价为 0 的房源（合租分摊、包水电）
 * 上月明明走了用量却弹出「不弹」。改为「有钱或有量」任一成立即可 ——
 * 完全没有读数的月份根本不会生成账单（recomputeAll 只遍历有读数的月份），
 * 所以这里不需要再兜一层「该月是否有读数」。
 */
function hasContent(bill: Bill): boolean {
  return bill.totalCost > 0 || bill.electricityUsage > 0 || bill.waterUsage > 0;
}

export interface MonthlyBillPromptOptions {
  /** 当前是否允许弹（新手引导 / Tour 占用时应返回 false） */
  canShow: () => boolean;
}

/** 展示上月结算单的结果，供调用方给用户明确回执 */
export type ShowLastMonthResult =
  | 'shown' // 已弹出
  | 'busy' // 已有浮层占用（或弹层正显示中）
  | 'not-ready' // 启动数据未就绪（bootstrap 失败）
  | 'no-premise' // 没有当前房源
  | 'no-bill' // 上月没有账单（即上月没有任何读数）
  | 'empty'; // 上月账单无金额也无用量

/** 解析上月账单的失败原因 */
type ResolveFailure = 'no-bill' | 'empty';
type ResolveResult = { ok: true; bill: Bill } | { ok: false; reason: ResolveFailure };

export function useMonthlyBillPrompt(options: MonthlyBillPromptOptions) {
  const settings = useSettingsStore();
  const premises = usePremisesStore();
  const bills = useBillsStore();

  const bill = ref<Bill | null>(null);
  const visible = ref(false);

  /** 并发守卫：visibilitychange / 定时器 / 首次 check 可能在同一时刻触发 */
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** 上次见到的日期，用于检测「跨日」（含跨月） */
  let lastSeenDate = dateKey();

  async function check(): Promise<void> {
    if (running || visible.value) return;
    running = true;
    try {
      await checkOnce();
    } finally {
      running = false;
    }
  }

  /**
   * 取「当前房源 + 上月账单」。
   *
   * 定向重算上月：保证拿到的是「当前读数 + 当前单价」的最新口径，
   * 而不是库里可能已过期的历史值（用户上月最后一天补录读数时尤甚）。
   * 重算幂等：金额没变就不写库、不自增版本、不触发同步。
   */
  async function resolveLastMonthBill(premiseId: string, ym: string): Promise<ResolveResult> {
    const existing = bills.billForMonth(ym, premiseId);
    if (!existing) {
      // 上月没有账单 = 上月没有任何读数（账单由 recomputeAll 按有读数的月份生成），
      // 此时不重算：凭空造一张全 0 的空账单写进库，会污染账单列表与同步快照。
      return { ok: false, reason: 'no-bill' };
    }

    let target = existing;
    try {
      target = await bills.recompute(premiseId, ym);
    } catch (err) {
      // 重算失败不阻断展示：用库里的值弹，总好过整个功能静默失效
      logger.warn('monthlyPrompt', '上月账单重算失败，改用库内值', {
        premiseId,
        yearMonth: ym,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // 空票没有信息量，只会变成打扰
    if (!hasContent(target)) return { ok: false, reason: 'empty' };
    return { ok: true, bill: target };
  }

  /** 等数据就绪并取出当前房源；取不到返回 null（已落日志） */
  async function ensureCurrentPremise(): Promise<string | null> {
    // Pinia setup store 会对顶层 ref 自动解包，这里拿到的是 boolean 而非 Ref
    if (!settings.loaded) await settings.load();
    if (!premises.loaded) await premises.load();
    const premiseId = premises.currentPremiseId;
    if (!premiseId) {
      logger.warn('monthlyPrompt', '当前房源为空，无法定位账单');
      return null;
    }
    return premiseId;
  }

  async function checkOnce(): Promise<void> {
    // 闸门 1：处于月初窗口内（1 ~ WINDOW_DAYS 号）
    if (dayjs().date() > WINDOW_DAYS) return;
    const thisMonth = monthKey();
    // 闸门 2：本月还没弹过
    if (getLastPopMonth() === thisMonth) return;
    // 闸门 3：引导已走完（首次启动先让用户熟悉 App，不叠加打扰）
    if (!isOnboarded()) return;
    // 闸门 4：没有更高优先级的浮层占着
    if (!options.canShow()) return;

    // 关键：等 bootstrap 把 settings / premises / readings / bills 装载并自愈重算完毕。
    // 此前这里是直接读 store —— app.mount 早于 bootstrap，App.vue 的微任务还排在前面，
    // 于是 currentPremiseId 恒为空、账单也还没重算，两条静默 return 让功能彻底失效。
    // bootstrap 失败时这里会 reject，由外层 catch 降级为「本次不弹」。
    await whenDataReady();

    // 闸门 5：设置开关。默认值虽为 true，但必须等 settings 装载之后才可信，
    //        否则会把「还没读库」误判成「用户关了这项」而漏弹。
    if (!settings.autoMonthlyBill) {
      logger.info('monthlyPrompt', '设置已关闭月初账单弹窗，跳过');
      return;
    }

    const premiseId = await ensureCurrentPremise();
    if (!premiseId) return;

    const ym = prevMonthKey(thisMonth);
    const result = await resolveLastMonthBill(premiseId, ym);
    if (!result.ok) {
      logger.info('monthlyPrompt', '上月账单不满足展示条件，跳过', {
        premiseId,
        yearMonth: ym,
        reason: result.reason,
      });
      return;
    }

    // 先落标记再显示：若渲染阶段抛错，也不至于每次启动都重弹同一张票
    setLastPopMonth(thisMonth);
    bill.value = result.bill;
    visible.value = true;
  }

  /**
   * 主动展示上月结算单（设置页入口）。
   *
   * 与自动弹层的差别：**跳过**「月初窗口」「本月未弹过」「设置开关」三道闸门 ——
   * 用户点按钮就是明确要看，被日期和开关挡住只会让人以为功能坏了。
   * 仍然保留「无房源 / 无账单 / 空账单」这三条硬条件，因为那不是打扰问题，是真的没东西可展示。
   *
   * 返回值供调用方给用户回执：静默失败最容易让人以为「点了没反应」。
   */
  async function showLastMonthBill(): Promise<ShowLastMonthResult> {
    if (visible.value || !options.canShow()) return 'busy';
    try {
      await whenDataReady();
    } catch (err) {
      logger.warn('monthlyPrompt', '数据未就绪，无法展示上月账单', {
        message: err instanceof Error ? err.message : String(err),
      });
      return 'not-ready';
    }

    const premiseId = await ensureCurrentPremise();
    if (!premiseId) return 'no-premise';

    const thisMonth = monthKey();
    const result = await resolveLastMonthBill(premiseId, prevMonthKey(thisMonth));
    if (!result.ok) return result.reason;

    // 手动查看也算「这个月已经看过上月结算单」：
    // 月初那几天用户主动看过了，自动弹层再弹一次就是纯粹的打扰。
    setLastPopMonth(thisMonth);
    bill.value = result.bill;
    visible.value = true;
    return 'shown';
  }

  function close(): void {
    visible.value = false;
    bill.value = null;
  }

  /** 跨日检测：应用常驻后台时，onMounted 不会再跑，靠这里补上「跨过月末零点」的情况 */
  function onDateChanged(): void {
    const today = dateKey();
    if (today === lastSeenDate) return;
    lastSeenDate = today;
    void check().catch((err) => {
      logger.warn('monthlyPrompt', '月初账单检查失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  function onVisibilityChanged(): void {
    if (typeof document === 'undefined') return;
    // 只在回到前台时检查：后台标签页弹窗用户也看不见，且会被浏览器节流
    if (document.visibilityState !== 'visible') return;
    onDateChanged();
  }

  function start(): void {
    if (timer !== null) return;
    lastSeenDate = dateKey();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChanged);
    }
    timer = setInterval(onDateChanged, DAY_CHECK_INTERVAL_MS);
    // 首次判定（内部会 await 启动数据就绪，不会抢在 bootstrap 前面）
    void check().catch((err) => {
      logger.warn('monthlyPrompt', '启动月初账单检查失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChanged);
    }
  }

  return { bill, visible, check, close, start, stop, showLastMonthBill };
}
