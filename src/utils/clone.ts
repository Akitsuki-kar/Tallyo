/**
 * 深拷贝工具：剥离 Vue reactive proxy，产出 IndexedDB structured clone 安全的纯对象。
 *
 * 背景：Pinia store 的 ref/reactive 返回的是 Proxy 代理对象，IndexedDB 的 put()
 * 依赖 structured clone 算法，遇到 Proxy 会抛 "could not be cloned" 错误。
 * Vue 的 toRaw() 只解一层，嵌套对象仍是 Proxy，因此用 JSON 往返做全量剥离。
 *
 * 本项目所有数据类型（string/number/boolean/null/数组/纯对象）均为 JSON 安全，
 * 不含 Date/Map/Set/Function 等无法 JSON 序列化的类型，可安全使用此方案。
 */

/**
 * 深拷贝任意值，剥离所有层级的 Vue reactive proxy。
 * 用于 repo 层 db.put() 前的防御性处理。
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
