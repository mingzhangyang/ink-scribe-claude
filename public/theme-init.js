// 在页面脚本加载前按保存的偏好（或系统配色）写入 <html data-theme>，避免首屏先闪一下深色。
// 偏好由 src/state/preferences.ts 以 "ink-scribe:prefs" 键保存；CSP 不允许内联脚本，所以单独成文件。
(function () {
  var theme;
  try {
    theme = (JSON.parse(localStorage.getItem("ink-scribe:prefs") || "{}").state || {}).theme;
  } catch (e) {
    // 无法读取本地存储时按系统配色
  }
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
