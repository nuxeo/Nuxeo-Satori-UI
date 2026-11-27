/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.Test;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.NuxeoException;

/**
 * The template's file read and checked, with no runtime: what is text, what is a placeholder, and
 * what is refused; and the Payers kit's six templates, which its seed gives the server, taken.
 */
public class TemplateTextTest {

    private static final Path KIT_LETTERS = Path.of("..", "business-apps", "packages", "payers-claims-demo", "demo",
            "letters");

    private static void refused(String text) {
        try {
            TemplateText.parse(TemplateText.Format.HTML, text);
            fail("taken: " + text);
        } catch (NuxeoException e) {
            assertEquals(text, 400, e.getStatusCode());
        }
    }

    @Test
    public void textAndPlaceholdersAreReadInOrder() {
        TemplateText.Parsed parsed = TemplateText.parse(TemplateText.Format.HTML,
                "<p>Dear {{ tclaim:member>tmember:firstName }},</p><p>{{tclaim:number}} {{letter.date}} {{tclaim:number}}</p>");
        assertEquals(List.of("tclaim:member>tmember:firstName", "tclaim:number", "letter.date"),
                parsed.placeholders().stream().map(Placeholder::text).toList());
        Placeholder reference = parsed.placeholders().get(0);
        assertEquals(Placeholder.Kind.REFERENCE, reference.kind());
        assertEquals("tclaim:member", reference.property());
        assertEquals("tmember:firstName", reference.target());
        assertEquals(Placeholder.Kind.LETTER, parsed.placeholders().get(2).kind());
        String filled = parsed.fill(Map.of(parsed.placeholders().get(0), "<Ana & Bo>", parsed.placeholders().get(1),
                "CLM-1", parsed.placeholders().get(2), "today"));
        assertEquals("<p>Dear &lt;Ana &amp; Bo&gt;,</p><p>CLM-1 today CLM-1</p>", filled);
    }

    @Test
    public void aTextTemplateIsFilledAsItIs() {
        TemplateText.Parsed parsed = TemplateText.parse(TemplateText.Format.TEXT, "A < B: {{tclaim:number}}\n");
        assertEquals("A < B: <x>\n", parsed.fill(Map.of(parsed.placeholders().get(0), "<x>")));
    }

    @Test
    public void theFormatIsHtmlOrText() {
        assertEquals(TemplateText.Format.HTML, TemplateText.format(Blobs.createBlob("x", "text/html; charset=UTF-8")));
        assertEquals(TemplateText.Format.TEXT, TemplateText.format(Blobs.createBlob("x", "text/plain")));
        assertEquals(TemplateText.Format.HTML,
                TemplateText.format(Blobs.createBlob("x", "application/octet-stream", null, "a.htm")));
        for (String mimeType : new String[] { "text/x-freemarker", "text/xml", "application/xhtml+xml", "image/svg+xml",
                "application/vnd.oasis.opendocument.text" }) {
            try {
                TemplateText.format(Blobs.createBlob("x", mimeType, null, "a.html"));
                fail(mimeType);
            } catch (NuxeoException e) {
                assertEquals(400, e.getStatusCode());
            }
        }
    }

    @Test
    public void whatIsRefused() {
        for (String text : new String[] { "${x}", "<#if x></#if>", "[#if x][/#if]", "<@x/>", "#{x}", "#set($a=1)",
                "#if ($a)", "$a", "${", "$!a", "<% x %>", "{% x %}", "<p onclick=\"x\">", "<a href=\"x\">",
                "<p style=\"x:url(y)\">", "<script>", "<meta name=\"x\">", "<meta charset=\"utf-8\" name=\"x\">",
                "<!DOCTYPE x>", "<!-- open", "<style>p{}", "<p>{{tclaim:number}</p>", "<p>{tclaim:number}}</p>",
                "{{a}}", "{{a:b>c:d>e:f}}", "{{a:b/c>d:e}}", "{{letter.other}}", "{{a:b/c/d/e/f}}", "\u0000",
                "<p>{{a:b}}</p><p class=x{{a:b}}>", "</p class=\"x\">" }) {
            refused(text);
        }
        StringBuilder many = new StringBuilder();
        for (int i = 0; i <= TemplateText.MAX_PLACEHOLDERS; i++) {
            many.append("{{a:b}}");
        }
        refused(many.toString());
        try {
            TemplateText.parse(Blobs.createBlob(new byte[] { (byte) 0xC3, (byte) 0x28 }, "text/html"));
            fail("not UTF-8, taken");
        } catch (NuxeoException | java.io.IOException e) {
            assertTrue(e instanceof NuxeoException);
        }
        try {
            TemplateText.parse(Blobs.createBlob("x".repeat(TemplateText.MAX_BYTES + 1), "text/html"));
            fail("too long, taken");
        } catch (NuxeoException e) {
            assertEquals(400, e.getStatusCode());
        }
    }

    @Test
    public void whatIsTaken() {
        for (String text : new String[] { "", "plain text", "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
                + "<title>T {{a:b}}</title><style>p { margin: 0 } .x > p { color: gray }</style></head>"
                + "<body><!-- a note --><table><tr><th colspan=\"2\">x</th></tr></table><br/><hr></body></html>",
                "<p>US$ 5, 50% and 100%, #1, a > b, {single} braces, $ 10</p>", "<P CLASS='x'>{{A_b:C9/d}}</P>" }) {
            TemplateText.parse(TemplateText.Format.HTML, text);
        }
    }

    @Test
    public void thePayersKitsTemplatesAreTaken() throws Exception {
        List<Path> files;
        try (var listed = Files.list(KIT_LETTERS)) {
            files = listed.filter(p -> p.toString().endsWith(".html")).sorted().toList();
        }
        assertEquals(6, files.size());
        for (Path file : files) {
            String text = Files.readString(file, StandardCharsets.UTF_8);
            TemplateText.Parsed parsed = TemplateText.parse(
                    Blobs.createBlob(text, "text/html", "UTF-8", file.getFileName().toString()));
            assertFalse(file.toString(), parsed.placeholders().isEmpty());
            for (Placeholder placeholder : parsed.placeholders()) {
                if (placeholder.kind() != Placeholder.Kind.LETTER) {
                    String prefix = placeholder.property().substring(0, placeholder.property().indexOf(':'));
                    assertTrue(file + ": " + placeholder.text(), prefix.equals("claim") || prefix.equals("case"));
                }
            }
        }
    }
}
