package org.nuxeo.agentic.config;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What the diagnostics page says of a configuration message, cleaned of anything that may be a
 * secret or personal data, because its "copy for support" text is made to be sent outside the
 * company ({@link DiagnosticsReport}).
 *
 * The configuration's own messages name files, components and bundles, and none is meant to carry
 * either; but a message may quote an exception's text, which may quote a path or an address. So,
 * whatever the message:
 *
 * <ul>
 * <li>an email address is {@value #EMAIL};</li>
 * <li>a URL keeps its scheme, host and path: who it signs in as and its query are dropped;</li>
 * <li>a home directory's owner, in {@code /home/<name>}, {@code /Users/<name>} or {@code
 * C:\Users\<name>}, is {@value #USER};</li>
 * <li>anything shaped like a key or a token, a run of {@value #TOKEN_LENGTH} or more letters,
 * digits, {@code _}, {@code -}, {@code +} or {@code =} with a digit and a letter in it, is {@value
 * #SECRET};</li>
 * <li>a control character is a space, and the whole is at most {@value #MAX_LENGTH} characters.</li>
 * </ul>
 *
 * It does not make an arbitrary text safe to publish: it is the second line, after the server's
 * messages, which are written to name no person and no secret.
 */
final class Redaction {

    static final String EMAIL = "[email]";

    static final String USER = "[user]";

    static final String SECRET = "[redacted]";

    static final int TOKEN_LENGTH = 24;

    static final int MAX_LENGTH = 500;

    private static final Pattern EMAILS = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");

    /** A URL's scheme, who it signs in as, its host and path, and its query or fragment. */
    private static final Pattern URLS = Pattern.compile(
            "\\b([a-zA-Z][a-zA-Z0-9+.-]{1,15}://)(?:[^\\s/@?#]*@)?([^\\s/?#]+)([^\\s?#]*)(?:[?#]\\S*)?");

    private static final Pattern HOMES = Pattern.compile("(/home/|/Users/|[A-Za-z]:\\\\Users\\\\)[^/\\\\\\s]+");

    private static final Pattern TOKENS = Pattern.compile(
            "(?<![A-Za-z0-9_+=-])(?=[A-Za-z0-9_+=-]*[0-9])(?=[A-Za-z0-9_+=-]*[A-Za-z])[A-Za-z0-9_+=-]{"
                    + TOKEN_LENGTH + ",}(?![A-Za-z0-9_+=-])");

    private Redaction() {
    }

    static String clean(String message) {
        if (message == null) {
            return "";
        }
        StringBuilder printable = new StringBuilder();
        message.codePoints()
               .limit(MAX_LENGTH * 4L)
               .forEach(point -> printable.appendCodePoint(Character.isISOControl(point) ? ' ' : point));
        // URLs first: who a URL signs in as would otherwise read as an address, and its host be lost.
        String text = URLS.matcher(printable).replaceAll("$1$2$3");
        text = EMAILS.matcher(text).replaceAll(Matcher.quoteReplacement(EMAIL));
        text = HOMES.matcher(text).replaceAll(match -> Matcher.quoteReplacement(match.group(1) + USER));
        text = TOKENS.matcher(text).replaceAll(Matcher.quoteReplacement(SECRET));
        if (text.codePointCount(0, text.length()) > MAX_LENGTH) {
            text = text.substring(0, text.offsetByCodePoints(0, MAX_LENGTH - 1)) + "…";
        }
        return text;
    }
}
