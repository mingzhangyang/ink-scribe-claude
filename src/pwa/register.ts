import { useSyncExternalStore } from "react";

/** PWA 状态：注册 Service Worker、保存浏览器的安装提示，并在新版本就绪时提示刷新。 */

type BeforeInstallPromptEvent = Event & { prompt(): Promise<void> };

export type PwaState = {
  /** 浏览器允许安装（收到了 beforeinstallprompt） */
  installable: boolean;
  /** 新版本已下载，刷新后生效 */
  updateReady: boolean;
};

let state: PwaState = { installable: false, updateReady: false };
let installEvent: BeforeInstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;
let reloadOnControllerChange = false;
const listeners = new Set<() => void>();

function setState(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function startPwa(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    // 不使用浏览器默认的安装横幅，改由菜单中的“安装应用”触发
    event.preventDefault();
    installEvent = event as BeforeInstallPromptEvent;
    setState({ installable: true });
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    setState({ installable: false });
  });

  // 开发服务器不注册：Vite 的模块与热更新不应被缓存
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadOnControllerChange) return;
    reloadOnControllerChange = false;
    location.reload();
  });
  // 等页面加载完成再注册，避免预缓存与首屏抢带宽
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => void register(), { once: true });
}

async function register() {
  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  } catch {
    // 隐私模式或浏览器禁用了 Service Worker：应用照常在线使用
  }
  // 部分自动化浏览器屏蔽 Service Worker 时 register() 不返回注册对象
  if (!registration) return;
  const track = (worker: ServiceWorker | null) => {
    if (!worker) return;
    const check = () => {
      // 页面已受控时新安装的版本才是“更新”；首次安装会直接接管页面
      if (worker.state !== "installed" || !navigator.serviceWorker.controller) return;
      waitingWorker = worker;
      setState({ updateReady: true });
    };
    check();
    worker.addEventListener("statechange", check);
  };
  track(registration.waiting);
  // 另一个标签页可能已经在安装新版本，updatefound 早于本页注册时触发
  track(registration.installing);
  registration.addEventListener("updatefound", () => track(registration.installing));
  // 长时间开着的页面回到前台时检查新版本
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void registration.update().catch(() => {});
  });
}

/** 弹出浏览器的安装确认；每次 beforeinstallprompt 事件只能使用一次。 */
export async function promptInstall(): Promise<void> {
  const event = installEvent;
  if (!event) return;
  installEvent = null;
  setState({ installable: false });
  await event.prompt().catch(() => {});
}

/** 启用已下载的新版本并刷新页面。另一个标签页已经启用新版本时直接刷新。 */
export function applyUpdate(): void {
  if (waitingWorker?.state === "installed") {
    reloadOnControllerChange = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  } else {
    location.reload();
  }
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
