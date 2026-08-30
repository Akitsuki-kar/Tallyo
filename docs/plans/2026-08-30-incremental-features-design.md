# 水电动账（SDB）增量功能设计 — 2026-08-30

> 范围：修复「补录历史读数不重算旧账单」bug + 6 项新需求（结算模式 / 房租 / 每日统计 / 快速记录时机 / 月初自动弹账单 / 版本号）。
> 取舍原则：核心计算与 UI 解耦（沿用 `billing.ts` / `pricing.ts` 纯函数 + `test:pure` 单测文化）；跨端同步沿用现有 LWW + `syncVersion` 机制，新增字段尽量挂在既有可同步实体（Premise / Settings）上，避免新增同步维度。

---

## 0. 修复：补录历史读数后旧账单不重算

**根因**：`readings.ts` 的 `relinkAndRecompute(premiseId, type, extraMonths)` 只重算「改动所在月份 + 链上变更记录所在月份」。但某月月末读数是**下一月**的基准线（`monthlyUsage`：次月净用量 = 次月末读数 − 本月末读数），所以补录/修改较早月份读数时，紧随其后的那个月账单的基准线变了，却没被重算。

**修复**：
- 在 `relinkAndRecompute` 组装 `months` 集合后，对每个受影响月份 `M` 追加重算 `nextMonth(M)`（用 dayjs 处理跨年，如 `2025-12 → 2026-01`）。
- `computeBill` 已有幂等短路（`isSameBillValue`）：下一月值未变则不写库、不涨 `syncVersion`、不发事件，**不会**触发同步乒乓。
- 受影响路径（`addReading` / `updateReading` / `removeReading`）全部经此函数，一处修复全量生效。

---

## 1. 数据模型变更

### 1.1 `Premise` 实体（新增结算模式 + 房租，跟随房源同步）

```ts
// types/models.ts
export type SettlementMode = 'full' | 'integer';      // 全额 / 整额
export type RoundingMode = 'round' | 'floor' | 'ceil';      // 四舍五入 / 直接舍弃 / 不足进一（有小数即进位）
export interface UtilitySettlement {
  mode: SettlementMode;
  rounding: RoundingMode; // 仅 mode==='integer' 时生效
}
export interface Premise extends EntityBase {
  name: string;
  note?: string;
  // —— 新增 ——
  settlement: { electricity: UtilitySettlement; water: UtilitySettlement };
  rent: number;          // 每月房租，0 表示不收
  rentVisible: boolean;  // 是否在账单中展示房租
}
```

> 结算模式按**水电各自独立**设置（用户确认）；房租**不设**结算模式，按填写金额全额计入。
> 这些字段挂在 `Premise` 上 → 变更自动 `syncVersion++` + 发 `PREMISE_CHANGED` → 走现有自动同步链路，无需新增同步维度。

### 1.2 `Settings` 实体（快速记录时机 + 月初弹账单开关）

```ts
export type QuickRecordPop = 'off' | 'daily' | 'always';
// 旧字段 autoPopQuickRecord: boolean 升级为 quickRecordPop
export interface Settings {
  // ...
  quickRecordPop: QuickRecordPop; // 替换 autoPopQuickRecord
  autoMonthlyBill: boolean;       // 每月 1 号自动弹上月结算账单（默认 false）
  templateId: BillTemplateId;     // 复用为「默认账单样式」（功能 5 的样式来源）
  // ...其余不变
}
```

> 兼容迁移：`settings.load()` 若读到旧 `autoPopQuickRecord: true` → 映射为 `'daily'`（保留当前「每天弹一次」行为），`false` → `'off'`。

### 1.3 `Bill` 实体（快照房租，结算金额随模式变化）

```ts
export interface Bill extends EntityBase {
  // ...既有 electricityUsage/electricityCost/waterUsage/waterCost/totalCost
  // electricityCost / waterCost / totalCost 在「整额」模式下存**已取整**值；「全额」下与现行为一致（2 位小数）
  rent: number;          // 快照：生成账单时的房租（房租不参与取整）
  rentVisible: boolean;  // 快照：当时是否展示房租
}
```

---

## 2. 计算层变更

### 2.1 `utils/pricing.ts` 新增 `applySettlement`

```ts
export function applySettlement(cost: number, s: UtilitySettlement): number {
  if (s.mode === 'full') return round2(cost);
  return s.rounding === 'round' ? Math.round(cost) : Math.trunc(cost);
}
```

### 2.2 `stores/bills.ts` `computeBill` 改造

- 取该房源 `settlement` 与 `rent`/`rentVisible`（`premisesStore.currentOrById`）。
- `eleFinal = applySettlement(eleCost, settlement.electricity)`；`waterFinal` 同理。
- `rentFinal = rentVisible && rent > 0 ? rent : 0`（全额、不参与取整）。
- `totalCost = round2(eleFinal + waterFinal + rentFinal)`。
- 写入 `bill.rent` / `bill.rentVisible`，`electricityCost`/`waterCost`/`totalCost` 存结算后值。

### 2.3 新增 `recomputePremise(premiseId)`

- 扫描该房源所有有读数的月份（复用 `recomputeAll` 的 pair 收集但限定 premiseId），逐月 `computeBill`。
- 供「结算模式 / 房租 变更」后整体重算该房源历史账单（与 Budget 变更重算同模式）。

---

## 3. 各项功能设计

### 功能 1 — 结算模式（按水电各自，与房源绑定，可同步）
- **UI**：`PremiseManager.vue` 编辑/新增表单内，电、水各一组选择器：
  - 全额结算 / 整额结算（选整额再展开「四舍五入 / 直接舍弃 / 不足进一」三选一）。
- **落库**：调新增 `premisesStore.setPremiseBilling(patch)` → `updatePremise` 写库 + `recomputePremise(premiseId)` 重算该房源全部账单 + 发 `PREMISE_CHANGED`。
- **同步**：随 Premise 实体自动同步；对端 `applySnapshot` 后走既有 `relinkChains(true)` + `recomputeAll`，账单自然反映新结算模式。

### 功能 2 — 房租（与房源绑定，可同步）
- **UI**：`PremiseManager.vue` 表单内「每月房租」数字输入（默认 0）+「在账单中显示」开关。
- **逻辑**：`computeBill` 中 `rentFinal` 如上；账单模板（4 个）增加「房租」行（仅 `rentVisible && rent>0` 时显示）。
- **同步**：随 Premise 实体同步。

### 功能 3 — 当月每日统计（当前房源维度）
- **新增纯函数** `utils/billing.ts`：`dailyStats(premiseId, yearMonth, price, settlement?)` → 返回该月每日 `{ date, eleUsage, waterUsage, eleCost, waterCost, eleDeltaPct, waterDeltaPct }`。
  - 每日用量 = 当日各读数 `usageOf(r) = r.reading - r.previousReading` 之和（链派生，净消耗）。
  - 每日费用 = 用量 × 单价（统计用原始精度，不取整，避免误导）。
  - 涨幅 = 相对前一日用量/费用的环比 %，**涨红跌绿**（沿用 Stats 现有色调约定）。
- **UI**：`Stats.vue` 顶部新增「按月 / 每日」切换；选「每日」渲染：
  - 房源沿用现有选择器（默认当前房源）；月份默认可选（默认当月）。
  - ECharts 组合图：电/水每日费用柱 + 涨幅折线（双 Y 轴）；下方每日明细列表（用量、费用、涨幅徽标）。
- **测试**：补 1–2 条 `dailyStats` 纯函数断言进 `scripts/test-pure-functions.ts`。

### 功能 4 — 快速记录弹窗时机（可同步）
- `Settings.quickRecordPop: 'off' | 'daily' | 'always'`。
- `App.vue` `onMounted` 逻辑：
  - `'off'` → 不弹。
  - `'daily'` → 仍用 `localStorage['sdb:lastQuickPopDate']` 按日去重（**保留现状行为**）。
  - `'always'` → 跳过日期去重，每次启动都弹。
- **UI**：`Settings.vue` 将原来「启动自动弹快速记录」开关改为三段选择（关 / 每天首次 / 每次打开）。
- **同步**：随 Settings（`syncSettings`）自动同步。

### 功能 5 — 月初自动弹上月结算账单（带打印特效，可同步、可关）
- `Settings.autoMonthlyBill: boolean`（默认 false，设置页可关）。
- `App.vue` `onMounted`：若 `autoMonthlyBill && 今天为 1 号`，且 `localStorage['sdb:lastMonthlyBillPop'] !== 当前年月` → 打开 `MonthlyBillModal`，记录已弹月份（每月仅弹一次）。
- **弹窗内容**：用 `settings.templateId` 渲染上月账单（取 `bills.billForMonth(lastMonth, currentPremiseId)`）；内嵌**打印特效原型**（见下，待你确认动画后再落地为 `MonthlyBillModal.vue` + `printBill` 调用现有 `utils/pdf.ts`）。
- **动画（原型待确认）**：打印机在屏幕底部 → 小票从出纸口缓慢吐出 → 提供「打印 PDF」按钮 → 点击后小票带**锯齿撕边**从打印机撕下、平移放大到屏幕正中。
- **同步**：`autoMonthlyBill` 随 Settings 同步。

### 功能 6 — 版本号升级到 0.1.1
- `package.json` → `"version": "0.1.1"`（构建产物/关于页随之更新）。
- 同步检查 `src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 的 `version` 字段一并升级（保持一致，避免原生壳版本落后）。
- 若设置页有「关于/版本」展示，同步更新文案。

---

## 4. 同步影响总览

| 功能 | 载体 | 同步方式 |
|---|---|---|
| 结算模式 / 房租 | `Premise` 实体字段 | 随房源 LWW 同步；对端 `applySnapshot` 后 `recomputeAll` 重算账单 |
| 快速记录时机 | `Settings.quickRecordPop` | 随 Settings（`syncSettings`）同步 |
| 月初弹账单 | `Settings.autoMonthlyBill` | 随 Settings 同步 |
| 每日统计 | 纯派生（无新持久化） | 不涉及 |
| 版本号 | 构建元数据 | 不涉及数据同步 |

> 关键不变量：账单永远由「读数 + 单价 + 房源(结算/房租)」派生，`computeBill` 幂等。跨设备靠同步「源数据」而非「账单结果」，避免结算口径不一致。

---

## 5. 待确认 / 风险

1. **功能 5 打印动画**：本设计附交互原型，动画细节（撕边样式、是否要音效/纸张纹理）需你确认后再实现为 Vue 组件。
2. **整额模式下账单是否展示原始小数**：当前方案「整额」下 `electricityCost/waterCost` 直接存整数；若你希望明细仍显示 2 位小数、仅总额取整，请回头改功能 1 口径（本次按你答复「分项取整」实现）。
3. **每日统计费用用原始精度**：统计图表/明细不套用结算取整，仅展示真实用量费用；如需要也可套用，待确认。
4. **回归**：改动 `computeBill` 后需跑 `npm run test:pure` + 现有 32 项断言；新增 `dailyStats` / `applySettlement` 断言。
