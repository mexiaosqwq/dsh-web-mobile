// Build-time removal of CSS comments from the stylesheet modules (2026-11-03).
//
// The four styles/*.css.ts modules are template-literal CSS whose comments are
// the design record (owner decisions, measurements, host archaeology). They are
// ~60% of the injected stylesheet and shipped verbatim inside lib/client.js,
// then parsed by the browser on every page load. Sources keep every comment;
// only the emitted bundle drops them.
//
// Safe by construction for this repo's CSS: it has no string literal or url()
// containing "/*" (tests/strip-css-comments.test.ts pins that, and asserts the
// parsed rule list is identical before and after stripping).

/** Remove every CSS block comment and collapse the blank runs they leave. */
export function stripCssComments(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
}

/** Strip the CSS inside `exports.<NAME>_CSS = \`...\`` of one tsc-emitted module. */
export function stripEmittedCssModule(source) {
  return source.replace(/(exports\.[A-Z_]+_CSS = `)([\s\S]*?)(`;)/g, (_, open, css, close) => {
    if (css.includes('${')) throw new Error('styles module uses interpolation; refusing to strip')
    return open + stripCssComments(css) + close
  })
}
