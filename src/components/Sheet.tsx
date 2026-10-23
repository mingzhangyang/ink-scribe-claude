import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";

// 关闭动画的最长时间；动画事件因故没有触发（例如标签页在后台）时，到时也会关闭
const CLOSE_FALLBACK_MS = 400;
// 与 CSS 中底部抽屉的断点一致：只有抽屉形态可以下滑关闭
const DRAWER_QUERY = "(max-width: 640px)";
// 可见区域比对话框所在区域矮这么多时才认为弹出了软键盘，忽略浏览器工具栏伸缩等小变化
const KEYBOARD_MIN_PX = 80;
// 下滑超过抽屉高度的这个比例，或以较快速度（px/ms）下滑时关闭；否则弹回
const DISMISS_RATIO = 0.25;
const DISMISS_VELOCITY = 0.5;

type Drag = { id: number; startY: number; lastY: number; lastTime: number; velocity: number };

/** 可以按住拖动抽屉的位置：标记为 [data-sheet-drag] 的区域中，按钮、下拉框等控件之外的部分。 */
function isDragHandle(target: EventTarget): boolean {
  return target instanceof Element && !!target.closest("[data-sheet-drag]") && !target.closest("button, select, input, textarea, a, label");
}

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
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      // 下滑关闭的动画还没结束就重新打开时，清掉拖动留下的位移
      delete dialog.dataset.closing;
      dialog.style.removeProperty("transform");
      if (!dialog.open) {
        dialog.showModal();
        // 使用鼠标时直接聚焦输入框；触屏上聚焦对话框本身，不主动弹出软键盘
        const target = matchMedia("(pointer: fine)").matches ? dialog.querySelector<HTMLElement>("[data-autofocus]") : null;
        (target ?? dialog).focus();
      }
      return;
    }
    if (!dialog.open) return;
    // 先播放关闭动画再真正关闭；减少动态效果时没有动画，立即关闭。
    // 下滑关闭时保留拖动的位移，关闭动画从当前位置继续向下
    dialog.dataset.closing = "";
    const finish = () => {
      delete dialog.dataset.closing;
      dialog.style.removeProperty("transform");
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

  // 软键盘只缩小可见区域（visualViewport），贴底或居中的对话框会被键盘挡住：
  // 把对话框底边抬到可见区域底边，并把高度限制在可见区域内
  useEffect(() => {
    const dialog = ref.current;
    const viewport = window.visualViewport;
    if (!open || !dialog || !viewport) return;
    const reset = () => {
      delete dialog.dataset.keyboard;
      dialog.style.removeProperty("--keyboard-inset");
      dialog.style.removeProperty("--visible-height");
    };
    const update = () => {
      // 对话框以 inset: 0 定位，上下外边距加自身高度就是所在区域（布局视口）的高度，不受动画位移影响
      const style = getComputedStyle(dialog);
      const container = parseFloat(style.marginTop) + dialog.offsetHeight + parseFloat(style.marginBottom);
      const inset = Math.round(container - viewport.offsetTop - viewport.height);
      // 双指缩放也会缩小可见区域，此时不跟随
      if (inset < KEYBOARD_MIN_PX || Math.abs(viewport.scale - 1) > 0.01) return reset();
      dialog.dataset.keyboard = "";
      dialog.style.setProperty("--keyboard-inset", `${inset}px`);
      dialog.style.setProperty("--visible-height", `${Math.floor(viewport.height)}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      reset();
    };
  }, [open]);

  function startDrag(event: PointerEvent<HTMLDialogElement>) {
    if (event.button !== 0 || drag.current || !isDragHandle(event.target) || !matchMedia(DRAWER_QUERY).matches) return;
    drag.current = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = "";
  }

  function moveDrag(event: PointerEvent<HTMLDialogElement>) {
    const state = drag.current;
    if (!state || event.pointerId !== state.id) return;
    const elapsed = event.timeStamp - state.lastTime;
    if (elapsed > 0) state.velocity = (event.clientY - state.lastY) / elapsed;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    // 只能向下拖
    event.currentTarget.style.transform = `translateY(${Math.max(0, event.clientY - state.startY)}px)`;
  }

  function endDrag(event: PointerEvent<HTMLDialogElement>) {
    const state = drag.current;
    if (!state || event.pointerId !== state.id) return;
    drag.current = null;
    const dialog = event.currentTarget;
    delete dialog.dataset.dragging;
    const offset = Math.max(0, event.clientY - state.startY);
    const dismiss = event.type === "pointerup" &&
      (offset > dialog.offsetHeight * DISMISS_RATIO || (state.velocity > DISMISS_VELOCITY && offset > 24));
    if (dismiss) onClose();
    else dialog.style.removeProperty("transform"); // 由 CSS 过渡弹回原位
  }

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
      onPointerDown={(event) => {
        // 按下与松开都在遮罩上才关闭：在输入框里拖选文字、松手落在遮罩上时不关闭
        pressedBackdrop.current = event.target === event.currentTarget;
        startDrag(event);
      }}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // 拖动中对话框被关闭等情况下，捕获被释放而收不到 pointerup：结束拖动，避免之后无法再拖
      onLostPointerCapture={endDrag}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) onClose();
        pressedBackdrop.current = false;
      }}
    >
      {children}
    </dialog>
  );
}
