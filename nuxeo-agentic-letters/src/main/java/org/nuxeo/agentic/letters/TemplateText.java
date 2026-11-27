/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.NuxeoException;

/**
 * A letter template's file, read and checked: text and placeholders, and nothing that runs.
 *
 * <p>The add-on's processor is not a template engine: it has no expression, no directive, no call,
 * no include and no loop, so nothing in a template runs, whatever it holds. A template is refused
 * all the same when it holds another engine's syntax, so that no one mistakes it for one that runs,
 * and so that it runs nowhere else either should its type be changed; and, being HTML, when it holds
 * anything a browser runs or fetches. Checked when an administrator saves it and again each time a
 * letter is written from it.
 *
 * <ul>
 * <li><b>A file of the add-on's:</b> HTML ({@code text/html}, {@code .html}, {@code .htm}) or text
 * ({@code text/plain}, {@code .txt}), at most {@value #MAX_BYTES} bytes, UTF-8, with no control
 * character but tabs and line breaks.</li>
 * <li><b>No other engine's syntax:</b> FreeMarker's, Velocity's, JSP's, Jinja's and their kind
 * ({@link #FORBIDDEN}, {@link #VELOCITY}, {@link #REFERENCE}), anywhere, in either format.</li>
 * <li><b>HTML that runs and fetches nothing:</b> only the tags of {@link #TAGS} and the attributes
 * of {@link #ATTRIBUTES}, no {@code javascript:}, {@code url(}, {@code @import} or conditional
 * comment; no placeholder inside a tag, a comment or a style sheet, where a value could become
 * markup or a style. Read as a browser reads it: a comment's text holds no {@code -}, {@code <},
 * {@code >} or {@code !}; a {@code <title>} and a {@code <style>} hold no {@code <}; a style sheet
 * and a style attribute hold no parenthesis, {@code @}, backslash or {@code &}, so no function, no
 * at-rule and no escape; and no attribute's value holds a character reference.</li>
 * <li><b>A text template holds no markup:</b> no {@code <} before a letter, {@code /}, {@code !} or
 * {@code ?}.</li>
 * <li><b>Placeholders that parse</b> ({@link Placeholder}), at most {@value #MAX_PLACEHOLDERS} of
 * them, and no brace pair that is not one.</li>
 * </ul>
 */
final class TemplateText {

    static final int MAX_BYTES = 256 * 1024;

    static final int MAX_PLACEHOLDERS = 500;

    /** A file's format: what the letter is written as. */
    enum Format {
        HTML("text/html", ".html"),
        TEXT("text/plain", ".txt");

        final String mimeType;

        final String extension;

        Format(String mimeType, String extension) {
            this.mimeType = mimeType;
            this.extension = extension;
        }
    }

    /** What no template holds, anywhere, case aside: other engines' syntax, and what a browser runs or fetches. */
    static final List<String> FORBIDDEN = List.of("${", "#{", "<#", "</#", "[#", "[/#", "<@", "</@", "[@", "[/@",
            "<%", "%>", "{%", "%}", "$!", "javascript:", "vbscript:", "url(", "expression(", "@import", "<!--[if",
            "<![", "-moz-binding", "behavior:");

    /** Velocity's directives. */
    static final Pattern VELOCITY = Pattern.compile(
            "#(?:set|if|elseif|else|end|foreach|macro|include|parse|evaluate|define|break|stop)\\s*\\(",
            Pattern.CASE_INSENSITIVE);

    /** Velocity's and other engines' references: a dollar before a letter, a brace or a bang. */
    static final Pattern REFERENCE = Pattern.compile("\\$[A-Za-z{!]");

    /** The HTML tags a template may hold: a letter's text and its layout. */
    static final Set<String> TAGS = Set.of("html", "head", "body", "title", "meta", "style", "p", "br", "div",
            "span", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "small", "sub", "sup", "ul",
            "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "hr", "blockquote",
            "address", "header", "footer", "section", "article", "main");

    /** The attributes any of them may hold; {@code charset} on {@code meta} only, and it alone. */
    static final Set<String> ATTRIBUTES = Set.of("class", "style", "lang", "dir", "title", "colspan", "rowspan");

    private static final Pattern TAG = Pattern.compile(
            "<(/?)([A-Za-z][A-Za-z0-9]*)((?:\\s+[A-Za-z_:][-A-Za-z0-9_:.]*(?:\\s*=\\s*(?:\"[^\"<>]*\"|'[^'<>]*'|[^\\s\"'=<>`]+))?)*)\\s*/?>");

    private static final Pattern ATTRIBUTE = Pattern.compile(
            "([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\\s*=\\s*(\"[^\"<>]*\"|'[^'<>]*'|[^\\s\"'=<>`]+))?");

    private static final Pattern DOCTYPE = Pattern.compile("<!DOCTYPE\\s+html\\s*>", Pattern.CASE_INSENSITIVE);

    /** What a template reads as: literal text, and placeholders between. */
    record Parsed(Format format, List<Object> parts) {

        /** Its placeholders, in order, each once. */
        List<Placeholder> placeholders() {
            List<Placeholder> found = new ArrayList<>();
            for (Object part : parts) {
                if (part instanceof Placeholder placeholder && !found.contains(placeholder)) {
                    found.add(placeholder);
                }
            }
            return found;
        }

        /** The text, each placeholder replaced with its value, which is escaped for HTML. */
        String fill(Map<Placeholder, String> values) {
            StringBuilder out = new StringBuilder();
            for (Object part : parts) {
                if (part instanceof Placeholder placeholder) {
                    String value = values.get(placeholder);
                    if (value == null) {
                        throw new IllegalStateException("no value for " + placeholder.text());
                    }
                    out.append(format == Format.HTML ? escapeHtml(value) : value);
                } else {
                    out.append((String) part);
                }
            }
            return out.toString();
        }
    }

    private TemplateText() {
    }

    /** The format of {@code blob}, by its mime type, or by its file name when it has none of the two. */
    static Format format(Blob blob) {
        String mimeType = blob.getMimeType() == null ? "" : blob.getMimeType().toLowerCase(Locale.ROOT);
        int parameters = mimeType.indexOf(';');
        if (parameters >= 0) {
            mimeType = mimeType.substring(0, parameters).strip();
        }
        if (mimeType.equals(Format.HTML.mimeType)) {
            return Format.HTML;
        }
        if (mimeType.equals(Format.TEXT.mimeType)) {
            return Format.TEXT;
        }
        String name = blob.getFilename() == null ? "" : blob.getFilename().toLowerCase(Locale.ROOT);
        boolean undetected = mimeType.isEmpty() || mimeType.equals("application/octet-stream");
        if (undetected && (name.endsWith(".html") || name.endsWith(".htm"))) {
            return Format.HTML;
        }
        if (undetected && name.endsWith(".txt")) {
            return Format.TEXT;
        }
        throw Refusal.invalid("A letter template is an HTML or a text file, not " + Letters.quoted(
                blob.getMimeType() == null ? name : blob.getMimeType()));
    }

    /** {@code blob} read and checked. */
    static Parsed parse(Blob blob) {
        if (blob == null) {
            throw Refusal.invalid("A letter template needs its file, in file:content");
        }
        Format format = format(blob);
        return parse(format, read(blob));
    }

    /** {@code text}, in {@code format}, checked. */
    static Parsed parse(Format format, String text) {
        if (!text.isEmpty() && text.charAt(0) == '\uFEFF') {
            text = text.substring(1);
        }
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.isISOControl(c) && c != '\t' && c != '\n' && c != '\r') {
                throw Refusal.invalid("A letter template holds no control character");
            }
        }
        String lower = text.toLowerCase(Locale.ROOT);
        for (String forbidden : FORBIDDEN) {
            if (lower.contains(forbidden)) {
                throw Refusal.invalid("A letter template holds text and placeholders only, and this one holds "
                        + Letters.quoted(forbidden) + ": nothing in a template runs");
            }
        }
        Matcher velocity = VELOCITY.matcher(text);
        if (velocity.find()) {
            throw Refusal.invalid("A letter template holds no Velocity directive, and this one holds "
                    + Letters.quoted(velocity.group()));
        }
        Matcher reference = REFERENCE.matcher(text);
        if (reference.find()) {
            throw Refusal.invalid("A letter template holds no $ before a letter or a brace, and this one holds "
                    + Letters.quoted(reference.group()) + ": write an amount as USD 10, or with a placeholder");
        }
        if (format == Format.TEXT) {
            Matcher markup = MARKUP.matcher(text);
            if (markup.find()) {
                throw Refusal.invalid("A text letter template holds no markup, and this one holds "
                        + Letters.quoted(markup.group()));
            }
        }
        List<int[]> noPlaceholder = format == Format.HTML ? checkHtml(text) : List.of();
        return new Parsed(format, Collections.unmodifiableList(split(text, noPlaceholder)));
    }

    /** What would begin a tag, a comment or a declaration in a browser. */
    private static final Pattern MARKUP = Pattern.compile("<[A-Za-z/!?]");

    /** What a comment's text holds: none of the characters by which a browser ends one early. */
    private static final Pattern COMMENT_TEXT = Pattern.compile("[^-<>!]*");

    /**
     * What a style sheet, or a style attribute, holds: none of the characters CSS fetches, imports or
     * escapes with, a function's parenthesis, an at-rule's {@code @}, an escape's backslash, and no
     * {@code <} or {@code &}, which would end the sheet or be decoded into something else.
     */
    private static final Pattern CSS_FORBIDDEN = Pattern.compile("[(@\\\\<&]");

    /**
     * Every tag of {@code text} held to {@link #TAGS} and {@link #ATTRIBUTES}, with the ranges where a
     * placeholder may not be: each tag, each comment and each style sheet. Read as a browser reads
     * them: a comment's text holds none of the characters that end it early in a browser, and a
     * {@code <title>} and a {@code <style>} hold no {@code <}, so that each ends where a browser ends
     * it, at its closing tag.
     */
    private static List<int[]> checkHtml(String text) {
        List<int[]> ranges = new ArrayList<>();
        int i = 0;
        while ((i = text.indexOf('<', i)) >= 0) {
            if (text.startsWith("<!--", i)) {
                int end = text.indexOf("-->", i + 4);
                if (end < 0 || !COMMENT_TEXT.matcher(text.substring(i + 4, end)).matches()) {
                    throw Refusal.invalid("A letter template's comment is <!-- text -->, its text with no -, <, > "
                            + "or !, and closed");
                }
                ranges.add(new int[] { i, end + 3 });
                i = end + 3;
                continue;
            }
            if (text.startsWith("<!", i)) {
                Matcher doctype = DOCTYPE.matcher(text).region(i, text.length());
                if (!doctype.lookingAt()) {
                    throw Refusal.invalid("A letter template's only declaration is <!DOCTYPE html>");
                }
                i = doctype.end();
                continue;
            }
            Matcher tag = TAG.matcher(text).region(i, text.length());
            if (!tag.lookingAt()) {
                throw Refusal.invalid("A letter template's < begins a tag, and this one does not: "
                        + Letters.quoted(text.substring(i, Math.min(text.length(), i + 40)))
                        + ". Write &lt; for the character");
            }
            String name = tag.group(2).toLowerCase(Locale.ROOT);
            if (!TAGS.contains(name)) {
                throw Refusal.invalid("A letter template holds no <" + name + ">: its tags are a letter's text and layout");
            }
            boolean closing = !tag.group(1).isEmpty();
            String attributes = tag.group(3);
            if (closing && !attributes.isBlank()) {
                throw Refusal.invalid("A letter template's closing tag </" + name + "> has no attribute");
            }
            checkAttributes(name, attributes);
            ranges.add(new int[] { i, tag.end() });
            i = tag.end();
            if (!closing && (name.equals("style") || name.equals("title"))) {
                // Text to a browser up to its closing tag, never markup: so it holds no <.
                int end = text.indexOf('<', i);
                if (end < 0 || !text.regionMatches(true, end, "</" + name, 0, name.length() + 2)) {
                    throw Refusal.invalid("A letter template's <" + name + "> holds text alone, no <, and is closed");
                }
                if (name.equals("style")) {
                    Matcher css = CSS_FORBIDDEN.matcher(text.substring(i, end));
                    if (css.find()) {
                        throw Refusal.invalid("A letter template's style sheet holds no " + Letters.quoted(css.group())
                                + ": no function, at-rule or escape");
                    }
                    ranges.add(new int[] { i, end });
                }
                i = end;
            }
        }
        return ranges;
    }

    private static void checkAttributes(String tag, String attributes) {
        Matcher attribute = ATTRIBUTE.matcher(attributes);
        boolean charset = false;
        int count = 0;
        while (attribute.find()) {
            String name = attribute.group(1).toLowerCase(Locale.ROOT);
            String value = attribute.group(2) == null ? "" : attribute.group(2);
            count++;
            // A browser decodes a character reference in a value: none, so a value is what it reads.
            if (value.indexOf('&') >= 0) {
                throw Refusal.invalid("A letter template's attribute value holds no &");
            }
            if (name.equals("style")) {
                Matcher css = CSS_FORBIDDEN.matcher(value);
                if (css.find()) {
                    throw Refusal.invalid("A letter template's style attribute holds no " + Letters.quoted(css.group())
                            + ": no function, at-rule or escape");
                }
            }
            if (tag.equals("meta")) {
                if (!name.equals("charset")) {
                    throw Refusal.invalid("A letter template's <meta> holds its charset alone");
                }
                charset = true;
                continue;
            }
            if (!ATTRIBUTES.contains(name)) {
                throw Refusal.invalid("A letter template's <" + tag + "> holds no " + name + " attribute");
            }
        }
        if (tag.equals("meta") && (!charset || count != 1)) {
            throw Refusal.invalid("A letter template's <meta> holds its charset alone");
        }
    }

    /** {@code text} cut into literal text and placeholders. */
    private static List<Object> split(String text, List<int[]> noPlaceholder) {
        List<Object> parts = new ArrayList<>();
        int count = 0;
        int at = 0;
        while (at <= text.length()) {
            int open = text.indexOf("{{", at);
            String literal = open < 0 ? text.substring(at) : text.substring(at, open);
            if (literal.contains("}}")) {
                throw Refusal.invalid("A letter template's }} closes no placeholder");
            }
            if (!literal.isEmpty()) {
                parts.add(literal);
            }
            if (open < 0) {
                break;
            }
            int close = text.indexOf("}}", open + 2);
            if (close < 0) {
                throw Refusal.invalid("A letter template's {{ opens a placeholder it does not close");
            }
            String inner = text.substring(open + 2, close);
            if (inner.indexOf('{') >= 0 || inner.indexOf('}') >= 0) {
                throw Refusal.invalid("A letter template's placeholder holds no brace: " + Letters.quoted(inner));
            }
            for (int[] range : noPlaceholder) {
                if (open >= range[0] && open < range[1]) {
                    throw Refusal.invalid("A letter template's placeholder " + Letters.quoted(inner.strip())
                            + " is inside a tag, a comment or a style sheet: a placeholder is in the letter's text");
                }
            }
            Placeholder placeholder;
            try {
                placeholder = Placeholder.parse(inner);
            } catch (IllegalArgumentException e) {
                throw Refusal.invalid(
                        "A letter template's placeholder " + Letters.quoted(inner.strip()) + " " + e.getMessage());
            }
            if (++count > MAX_PLACEHOLDERS) {
                throw Refusal.invalid("A letter template holds at most " + MAX_PLACEHOLDERS + " placeholders");
            }
            parts.add(placeholder);
            at = close + 2;
        }
        return parts;
    }

    /** {@code blob}'s text, UTF-8, refused when it is longer than {@value #MAX_BYTES} bytes or is not UTF-8. */
    static String read(Blob blob) {
        byte[] bytes;
        try (InputStream in = blob.getStream()) {
            bytes = in.readNBytes(MAX_BYTES + 1);
        } catch (IOException e) {
            throw new NuxeoException("A letter template's file could not be read", e);
        }
        if (bytes.length > MAX_BYTES) {
            throw Refusal.invalid("A letter template is at most " + MAX_BYTES / 1024 + " KiB");
        }
        try {
            return StandardCharsets.UTF_8.newDecoder()
                                         .onMalformedInput(CodingErrorAction.REPORT)
                                         .onUnmappableCharacter(CodingErrorAction.REPORT)
                                         .decode(ByteBuffer.wrap(bytes))
                                         .toString();
        } catch (CharacterCodingException e) {
            throw Refusal.invalid("A letter template is UTF-8 text");
        }
    }

    /** {@code value} as HTML text, or within a quoted attribute. */
    static String escapeHtml(String value) {
        StringBuilder out = new StringBuilder(value.length() + 16);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
            case '&' -> out.append("&amp;");
            case '<' -> out.append("&lt;");
            case '>' -> out.append("&gt;");
            case '"' -> out.append("&quot;");
            case '\'' -> out.append("&#39;");
            default -> out.append(c);
            }
        }
        return out.toString();
    }
}
