import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Execute the script shipped by Rust so this test covers the WebView behavior.
const source = readFileSync(
  resolve(__dirname, "../src-tauri/src/lib.rs"),
  "utf8"
);
const script = source.match(/const INTERCEPT_SCRIPT: &str = r##"([\s\S]*?)"##;/)![1];

function installIntercept(path: string) {
  const href = `https://meet.google.com${path}`;
  const location = { href, pathname: path, origin: "https://meet.google.com" };
  const open = vi.fn();
  const listeners = new Map<string, (event: unknown) => void>();
  const window = { location, open };
  runInNewContext(script, {
    window,
    URL,
    console: { log: vi.fn() },
    document: {
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler);
      },
    },
  });
  return {
    window,
    open,
    initialUrl: href,
    click(href: string) {
      listeners.get("click")!({
        target: { closest: () => ({ href, getAttribute: () => "_blank" }) },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      });
    },
  };
}

describe.each([
  "/abc-defg-hij",
  "/meet/abc-defg-hij",
  "/meet/abc-defg-hij/",
  "/lookup/meeting",
])("meeting link navigation from %s", (path) => {
  const externalUrl = "https://www.google.com/url?url=https%3A%2F%2Fexample.com&source=chat";

  it("keeps the meeting when chat calls window.open", () => {
    const app = installIntercept(path);
    app.window.open(externalUrl, "_blank");
    expect(app.window.location.href).toBe(app.initialUrl);
    expect(app.open).toHaveBeenCalledWith(externalUrl, "_blank", undefined);
  });

  it("keeps the meeting when an external link is clicked", () => {
    const app = installIntercept(path);
    app.click(externalUrl);
    expect(app.window.location.href).toBe(app.initialUrl);
    expect(app.open).toHaveBeenCalledWith(externalUrl, "_blank");
  });

  it.each(["https://meet.google.com/", "https://meet.google.com/home"])(
    "allows navigation back to %s",
    (url) => {
      const app = installIntercept(path);
      app.click(url);
      expect(app.window.location.href).toBe(url);
      expect(app.open).not.toHaveBeenCalled();
    }
  );
});
