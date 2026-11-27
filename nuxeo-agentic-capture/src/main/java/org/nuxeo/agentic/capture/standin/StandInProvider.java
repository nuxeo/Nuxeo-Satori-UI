/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture.standin;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.nuxeo.agentic.capture.CaptureProvider;
import org.nuxeo.agentic.capture.CaptureProviderException;
import org.nuxeo.agentic.capture.CaptureSettings;
import org.nuxeo.agentic.capture.Profile.CaptureClass;
import org.nuxeo.agentic.capture.Profile.CaptureField;
import org.nuxeo.ecm.core.api.Blob;

/**
 * The stand-in provider, for development and demonstration servers: deterministic, with no service
 * and no setting of its own. It reads the item's own file as text, its first
 * {@value #MAX_READ} bytes, one byte a character, as a text file or a PDF whose text is not
 * compressed holds it, and nothing else: a scanned image gives it nothing, so its item waits for a
 * person.
 *
 * <ul>
 * <li><strong>Its class</strong> is the profile's class with the largest share of its keywords in
 * the text, in any letter case, the first declared on a tie; its confidence is that share,
 * rounded to two places. With no keyword found, it names no class.</li>
 * <li><strong>A field</strong> is read where the text says its label, a colon, and the value, up to
 * the line's end or a parenthesis, {@value #MAX_VALUE} characters at most. Its confidence is
 * {@value #FOUND} when its value is of the field's form, or it has none; {@value #NOT_OF_FORM}
 * otherwise. A field not found is not given.</li>
 * </ul>
 */
public class StandInProvider implements CaptureProvider {

    static final int MAX_READ = 1024 * 1024;

    static final int MAX_VALUE = 200;

    static final double FOUND = 0.97;

    static final double NOT_OF_FORM = 0.4;

    @Override
    public void init(String id, CaptureSettings settings) {
        // Nothing to keep: the stand-in reads no setting.
    }

    @Override
    public boolean configured() {
        return true;
    }

    @Override
    public Classification classify(Submission submission) throws CaptureProviderException {
        String text = text(submission.file()).toLowerCase(Locale.ROOT);
        CaptureClass best = null;
        double bestShare = 0;
        for (CaptureClass captureClass : submission.profile().classes()) {
            List<String> keywords = captureClass.keywords();
            if (keywords.isEmpty()) {
                continue;
            }
            long found = keywords.stream().filter(k -> text.contains(k.toLowerCase(Locale.ROOT))).count();
            double share = (double) found / keywords.size();
            if (share > bestShare) {
                best = captureClass;
                bestShare = share;
            }
        }
        if (best == null) {
            return new Classification(null, 0);
        }
        return new Classification(best.name(), Math.round(bestShare * 100) / 100.0);
    }

    @Override
    public Extraction extract(Submission submission, CaptureClass captureClass) throws CaptureProviderException {
        String text = text(submission.file());
        List<ExtractedField> fields = new ArrayList<>();
        for (CaptureField field : captureClass.fields()) {
            Matcher found = Pattern.compile("(?i)(?<![A-Za-z])" + Pattern.quote(field.label())
                    + "[ \\t]*:[ \\t]*([^\\r\\n()]{1," + MAX_VALUE + "})").matcher(text);
            if (!found.find()) {
                continue;
            }
            String value = found.group(1).trim();
            if (value.isEmpty()) {
                continue;
            }
            fields.add(new ExtractedField(field.name(), value, field.fits(value) ? FOUND : NOT_OF_FORM));
        }
        return new Extraction(fields);
    }

    /** The file's first bytes as text, one byte a character. */
    static String text(Blob file) throws CaptureProviderException {
        if (file == null) {
            return "";
        }
        try (InputStream in = file.getStream()) {
            return new String(in.readNBytes(MAX_READ), StandardCharsets.ISO_8859_1);
        } catch (IOException e) {
            throw new CaptureProviderException(CaptureProviderException.Kind.FAILED);
        }
    }
}
