import { marked, Renderer, type Token } from "marked";
import { type Highlighter, createHighlighter } from "shiki";

// ─── Comment Rendering ───
// Deliberately separate from renderMarkdown (~/lib/markdown.server).
//
// renderMarkdown handles lesson content and sales copy, which are written by
// instructors — trusted input, raw HTML allowed through. Comments are written by
// students, so the same treatment would be stored XSS against every reader,
// including the instructor and any admin who opens the questions queue.
//
// This renderer never emits author-supplied HTML:
//   - raw HTML blocks/tags are escaped and shown as literal text
//   - link hrefs are restricted to http/https/mailto and get rel="nofollow"
//   - images are dropped (rendered as their alt text)
//   - everything else goes through marked's own escaping
// Output is still injected with dangerouslySetInnerHTML, so any change here
// needs the same scrutiny.

const SAFE_LINK_PROTOCOLS = ["http:", "https:", "mailto:"];

const COMMENT_LANGS = [
  "typescript",
  "javascript",
  "json",
  "bash",
  "html",
  "css",
  "tsx",
  "jsx",
  "sql",
  "yaml",
  "markdown",
  "text",
  "plaintext",
];

let highlighter: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighter) {
    highlighter = await createHighlighter({
      themes: ["github-dark"],
      langs: COMMENT_LANGS,
    });
  }
  return highlighter;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Returns the href only when it uses a protocol we allow. Anything else —
 * javascript:, data:, vbscript:, or an unparseable URL — returns null so the
 * link is downgraded to plain text.
 */
function safeHref(href: string | null): string | null {
  if (!href) return null;

  const trimmed = href.trim();

  // Relative links stay on our own origin, so they're safe.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    return SAFE_LINK_PROTOCOLS.includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export async function renderComment(markdown: string): Promise<string> {
  const hl = await getHighlighter();

  const renderer = new Renderer();

  renderer.code = ({ text, lang }) => {
    const language = lang && COMMENT_LANGS.includes(lang) ? lang : "text";
    try {
      return hl.codeToHtml(text, { lang: language, theme: "github-dark" });
    } catch {
      return `<pre><code>${escapeHtml(text)}</code></pre>`;
    }
  };

  // Raw HTML is shown as text, never emitted as markup.
  renderer.html = ({ text }) => escapeHtml(text);

  renderer.link = function ({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const url = safeHref(href);

    if (!url) return text;

    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(url)}"${titleAttr} rel="nofollow noopener noreferrer" target="_blank">${text}</a>`;
  };

  // No images in comments — avoids tracking pixels and layout-breaking uploads.
  renderer.image = ({ text }) => escapeHtml(text ?? "");

  return marked.parse(markdown, { renderer, async: false }) as string;
}

// ─── Comment Excerpt ───
// Plain-text snippet of a Discussion comment for Notifications (feed row and
// email). Pure: walks marked's tokens instead of rendering HTML. Code is kept
// as text, images are dropped, tags are stripped and entities decoded.

export const EXCERPT_LENGTH = 140;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (entity, body: string) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const code = hex
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        return Number.isNaN(code) ? entity : String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    }
  );
}

const BLOCK_CONTAINERS = ["blockquote", "list_item"];

function tokenToText(token: Token): string {
  switch (token.type) {
    case "image":
      return "";
    case "html":
      return token.text.replace(/<[^>]*>/g, " ");
    case "code":
    case "codespan":
      return token.text;
    case "list":
      return token.items.map(tokenToText).join(" ");
    case "table":
      return [...token.header, ...token.rows.flat()]
        .map((cell) => cell.tokens.map(tokenToText).join(""))
        .join(" ");
    default:
      if ("tokens" in token && Array.isArray(token.tokens)) {
        // Inline children are adjacent text; block children need a gap.
        const gap = BLOCK_CONTAINERS.includes(token.type) ? " " : "";
        return token.tokens.map(tokenToText).join(gap);
      }
      return "text" in token && typeof token.text === "string"
        ? token.text
        : "";
  }
}

export function commentExcerpt(markdown: string): string {
  const text = decodeEntities(marked.lexer(markdown).map(tokenToText).join(" "))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= EXCERPT_LENGTH) return text;

  // One character past the limit tells us whether a word ends exactly there.
  const head = text.slice(0, EXCERPT_LENGTH + 1);
  const lastSpace = head.lastIndexOf(" ");
  const cut =
    lastSpace > 0 ? head.slice(0, lastSpace) : head.slice(0, EXCERPT_LENGTH);
  return cut.trimEnd() + "…";
}
