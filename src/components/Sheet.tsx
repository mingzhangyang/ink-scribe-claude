import { useEffect, useRef, type ReactNode } from "react";

// 关闭动画的最长时间；动画事件因故没有触发（例如标签页在后台）时，到时也会关闭
const CLOSE_FALLBACK_MS = 400;

/**
 * 基于原生 <dialog> 的模态面板：宽屏居中显示，窄屏由 CSS 显示为底部抽屉。
 * 焦点圈定、Esc 与 Android 返回键关闭、背景不可操作都由浏览器提供；
 * 关闭后元素仍留在 DOM 中，内部状态（如正在进行的文件导入）不会丢失。
 */
export function Sheet({ open, onClose, labelledBy, className, children }: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      delete dialog.dataset.closing;
      if (!dialog.open) {
        dialog.showModal();
        // 使用鼠标时直接聚焦输入框；触屏上聚焦对话框本身，不主动弹出软键盘
        const target = matchMedia("(pointer: fine)").matches ? dialog.querySelector<HTMLElement>("[data-autofocus]") : null;
        (target ?? dialog).focus();
      }
      return;
    }
    if (!dialog.open) return;
    // 先播放关闭动画再真正关闭；减少动态效果时没有动画，立即关闭
    dialog.dataset.closing = "";
    const finish = () => {
      delete dialog.dataset.closing;
      if (dialog.open) dialog.close();
    };
    if (getComputedStyle(dialog).animationName === "none") {
      finish();
      return;
    }
    const onEnd = (event: AnimationEvent) => {
      if (event.target === dialog) finish();
    };
    const timer = setTimeout(finish, CLOSE_FALLBACK_MS);
    dialog.addEventListener("animationend", onEnd);
    return () => {
      clearTimeout(timer);
      dialog.removeEventListener("animationend", onEnd);
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet${className ? ` ${className}` : ""}`}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onCancel={(event) => {
        // Esc：交给 onClose，以便播放关闭动画
        event.preventDefault();
        onClose();
      }}
      // 浏览器直接关闭对话框时（例如连续按返回键）同步状态。close 事件是异步派发的，
      // 派发前若已重新打开（关闭后立即再次点击入口），这是过期事件，忽略
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      // 按下与松开都在遮罩上才关闭：在输入框里拖选文字、松手落在遮罩上时不关闭
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) onClose();
        pressedBackdrop.current = false;
      }}
    >
      {children}
    </dialog>
  );
}
