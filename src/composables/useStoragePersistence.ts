/**
 * 持久化存储权限状态（高优①）。
 * 模块级单例：首次调用时异步申请 navigator.storage.persist()，并将结果暴露给 UI。
 * 本地优先账本若被浏览器在存储压力下静默清除会造成数据丢失，故需提示用户授权。
 */
import { ref } from 'vue';
import { requestPersistentStorage, type StoragePersistenceStatus } from '@/db/database';

const status = ref<StoragePersistenceStatus>('unknown');
let requested = false;

export function useStoragePersistence() {
  if (!requested) {
    requested = true;
    void requestPersistentStorage()
      .then((s) => {
        status.value = s;
      })
      .catch(() => {
        status.value = 'unknown';
      });
  }
  return { status };
}
