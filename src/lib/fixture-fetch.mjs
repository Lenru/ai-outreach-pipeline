// A fetch that reads saved pages from disk, so the live pre-send check can run
// on the example data with no network. https://site.example/robots.txt is read
// from <dir>/site.example/robots.txt, and "/" from index.html. A missing file
// is a 404, which is what a real site without that file returns.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function fixtureFetch(dir) {
  return async (url) => {
    const u = new URL(url);
    const file = join(dir, u.hostname, u.pathname === "/" ? "index.html" : u.pathname);
    try {
      const text = readFileSync(file, "utf8");
      return { status: 200, text: async () => text };
    } catch {
      return { status: 404, text: async () => "" };
    }
  };
}
