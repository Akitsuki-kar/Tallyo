/**
 * 轻量撤销管理器（体验⑫）。
 * 模块级单例：任意 store 在完成破坏性操作后调用 offer() 提供一段可撤销的闭包，
 * 由 App 顶层的撤销条渲染「已删除 X [撤销]」，5 秒后自动消失。
 */
import { ref } from 'vue';

const visible = ref(false);
const label = ref('');
let undoFn: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function useUndo() {
  function dismiss(): void {
    visible.value = false;
    undoFn = null;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  /** 提供一次撤销机会：展示 label，并在 ms 毫秒后自动消失 */
  function offer(text: string, fn: () => void, ms = 5000): void {
    label.value = text;
    undoFn = fn;
    visible.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(dismiss, ms);
  }

  /** 用户点击「撤销」：执行闭包后收起 */
  function run(): void {
    const fn = undoFn;
    dismiss();
    if (fn) fn();
  }

  return { visible, label, offer, dismiss, run };
}
