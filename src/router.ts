import { useSyncExternalStore, type MouseEvent } from "react";

/** 极简前端路由：编辑器、笔记查看页与图库，无需额外依赖。 */

export type Route =
  | { name: "editor" }
  | { name: "gallery" }
  | { name: "note"; id: string; render: boolean }
  | { name: "not-found" };

export function parseRoute(pathname: string, search: string): Route {
  if (pathname === "/" || pathname === "") return { name: "editor" };
  if (/^\/gallery\/?$/.test(pathname)) return { name: "gallery" };
  const note = pathname.match(/^\/n\/([A-Za-z0-9_-]{22})\/?$/);
  if (note) return { name: "note", id: note[1], render: new URLSearchParams(search).get("render") === "1" };
  return { name: "not-found" };
}

const listeners = new Set<() => void>();
let snapshot = `${location.pathname}${location.search}`;

function update() {
  snapshot = `${location.pathname}${location.search}`;
  listeners.forEach((listener) => listener());
}

window.addEventListener("popstate", update);

export function navigate(path: string): void {
  if (path === `${location.pathname}${location.search}`) return;
  history.pushState(null, "", path);
  window.scrollTo(0, 0);
  update();
}

export function useRoute(): Route {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
  return parseRoute(location.pathname, location.search);
}

/** 站内链接：普通点击走前端路由，修饰键点击保留浏览器默认行为（新标签页等）。 */
export function linkProps(path: string) {
  return {
    href: path,
    onClick(event: MouseEvent<HTMLAnchorElement>) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(path);
    },
  };
}
