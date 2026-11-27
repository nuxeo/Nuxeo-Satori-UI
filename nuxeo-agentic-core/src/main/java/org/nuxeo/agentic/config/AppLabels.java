package org.nuxeo.agentic.config;

import java.io.IOException;
import java.util.Iterator;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * An app's labels in a language other than English, as the app registry serves them: the
 * language's own texts over its English ones, key by key (docs/business-apps/app-definition-v2.md,
 * section 7).
 *
 * A language's file may give fewer keys than {@code labels/en.json}: the pipeline accepts a subset,
 * and refuses a key English lacks. So {@code labels/<language>.json} is answered with every key of
 * {@code labels/en.json}, the language's text where it gives a usable one, a text that is not empty,
 * and the English text where it does not. A key only the language gives is kept, as it was written,
 * for the app to judge as it judges any file. Keys are in English's order, then the language's own.
 *
 * Crowdin's approved-only export already writes every key, with the English source for a string
 * not yet approved, so a file it wrote is answered with the same texts. A file written by hand, or
 * one that predates keys added to English since, is answered as complete as English is.
 *
 * Answered as written, rather than merged: English itself; a language whose app has no
 * {@code labels/en.json}; and a file of either that is not a version 2 labels file, whose
 * {@code labels} is not an object, which the app reports and leaves out as it would the file alone.
 */
final class AppLabels {

    /** The English labels file, which every other language falls back to. */
    static final String ENGLISH = "labels/en.json";

    private static final Pattern LANGUAGE = Pattern.compile("labels/([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\\.json");

    private AppLabels() {
    }

    /** Whether {@code path} is a labels file of a language other than English. */
    static boolean isTranslation(String path) {
        if (path == null) {
            return false;
        }
        Matcher matcher = LANGUAGE.matcher(path);
        return matcher.matches() && !"en".equals(matcher.group(1));
    }

    /**
     * The language's labels over the English ones, or {@code language} as it is when either cannot
     * be read as a version 2 labels file.
     *
     * @param language the bytes of {@code labels/<language>.json}, as packaged
     * @param english the bytes of {@code labels/en.json}, as packaged, or {@code null} when the app
     *            has none
     */
    static byte[] withEnglish(byte[] language, byte[] english) {
        if (english == null) {
            return language;
        }
        ObjectNode translated = labelsFile(language);
        ObjectNode source = labelsFile(english);
        if (translated == null || source == null) {
            return language;
        }
        ObjectNode merged = ConfigSnapshot.JSON.createObjectNode();
        JsonNode own = translated.get("labels");
        for (Iterator<Map.Entry<String, JsonNode>> it = source.get("labels").fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> entry = it.next();
            JsonNode text = own.get(entry.getKey());
            merged.set(entry.getKey(), usable(text) ? text : entry.getValue());
        }
        for (Iterator<Map.Entry<String, JsonNode>> it = own.fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> entry = it.next();
            if (!merged.has(entry.getKey())) {
                merged.set(entry.getKey(), entry.getValue());
            }
        }
        translated.set("labels", merged);
        try {
            return ConfigSnapshot.JSON.writeValueAsBytes(translated);
        } catch (IOException e) {
            return language;
        }
    }

    /** A text the app shows: a string that is not blank, as the validator holds a label's text. */
    private static boolean usable(JsonNode text) {
        return text != null && text.isTextual() && !text.asText().isBlank();
    }

    /** The file as an object, when it is a version 2 labels file whose labels are an object. */
    private static ObjectNode labelsFile(byte[] bytes) {
        try {
            JsonNode node = ConfigSnapshot.JSON.readTree(bytes);
            if (node instanceof ObjectNode file && file.path("version").isInt() && file.get("version").asInt() == 2
                    && file.path("labels").isObject()) {
                return file;
            }
        } catch (IOException e) {
            // Not JSON: answered as it is, as the snapshot already reported.
        }
        return null;
    }
}
