/**
 * PWA 安装提示 composable（architecture.md §1.3）
 * 监听 beforeinstallprompt，用 localStorage 标记避免重复提示。
 */
import { ref, onMounted, onUnmounted } from 'vue';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const PROMPTED_KEY = 'sdb:pwa:prompted';

export function usePWAInstall() {
  const canInstall = ref(false);
  const installed = ref(false);
  let deferred: BeforeInstallPromptEvent | null = null;

  function handlePrompt(e: BeforeInstallPromptEvent): void {
    e.preventDefault();
    deferred = e;
    try {
      if (!localStorage.getItem(PROMPTED_KEY)) canInstall.value = true;
    } catch {
      canInstall.value = true;
    }
  }

  function handleAppInstalled(): void {
    installed.value = true;
    canInstall.value = false;
  }

  async function prompt(): Promise<void> {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    try {
      localStorage.setItem(PROMPTED_KEY, '1');
    } catch {
      /* 忽略 */
    }
    canInstall.value = false;
    deferred = null;
    if (choice.outcome === 'accepted') installed.value = true;
  }

  onMounted(() => {
    window.addEventListener('beforeinstallprompt', handlePrompt as EventListener);
    window.addEventListener('appinstalled', handleAppInstalled as EventListener);
  });

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', handlePrompt as EventListener);
    window.removeEventListener('appinstalled', handleAppInstalled as EventListener);
  });

  return { canInstall, installed, prompt };
}
