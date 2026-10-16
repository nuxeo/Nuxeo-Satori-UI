import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { renderTrustedHtml } from '@nuxeo/satori-platform/nuxeo-client';

/**
 * The five tags this pipe generates, and nothing else.
 *
 * This is the allow-list handed to DOMPurify, and it is deliberately the exact set the regexes
 * below produce. `value` is `<li value="N">` for ordered-list numbering; `class` is for styling.
 * Nothing here permits an attribute that can execute — no `on*`, no `href`, no `style`.
 */
const AI_MARKDOWN_POLICY = {
  ALLOWED_TAGS: ['strong', 'ol', 'ul', 'li', 'br'],
  ALLOWED_ATTR: ['class', 'value'],
};

@Pipe({ name: 'aiMarkdown', standalone: true })
export class AiMarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  /**
   * Renders a narrow subset of markdown from AI-generated text.
   *
   * `escapeHtml` runs first, then five regexes build the markup, then DOMPurify enforces
   * {@link AI_MARKDOWN_POLICY}. The DOMPurify pass is new: this pipe previously bypassed straight to
   * `innerHTML` on the strength of the escaping alone.
   *
   * That was safe, but only conditionally, and the condition was invisible. After `escapeHtml` no
   * `<` can originate in the input, and the one interpolated attribute is `value="$1"` where `$1` is
   * `(\d+)` — so nothing attacker-controlled reached an attribute position. The problem is that this
   * held only as long as all five regexes and `escapeHtml` stayed exactly as written, with nothing
   * checking that, while the input is AI-generated text derived from document content. A single
   * future regex interpolating a captured group into an attribute would have been stored XSS.
   *
   * Note `escapeHtml` does NOT escape `'`, which was load-bearing under the old arrangement: it was
   * safe purely because no generated attribute used single quotes. DOMPurify removes that dependency.
   */
  transform(value: string): SafeHtml {
    let html = this.escapeHtml(value);

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    html = html.replace(/^(\d+)\.\s+(.*)$/gm, '<li class="ai-ol-item" value="$1">$2</li>');
    html = html.replace(
      /((?:<li class="ai-ol-item"[^>]*>.*?<\/li>\n?)+)/g,
      '<ol class="ai-list">$1</ol>',
    );

    html = html.replace(/^[-•]\s+(.*)$/gm, '<li class="ai-ul-item">$1</li>');
    html = html.replace(
      /((?:<li class="ai-ul-item">.*?<\/li>\n?)+)/g,
      '<ul class="ai-list">$1</ul>',
    );

    html = html.replace(/\n/g, '<br>');
    html = html.replace(/(<\/?(?:ol|ul|li)[^>]*>)<br>/g, '$1');
    html = html.replace(/<br>(<\/?(?:ol|ul|li)[^>]*>)/g, '$1');

    return renderTrustedHtml(this.sanitizer, html, AI_MARKDOWN_POLICY);
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return text.replace(/[&<>"]/g, (c) => map[c]);
  }
}
