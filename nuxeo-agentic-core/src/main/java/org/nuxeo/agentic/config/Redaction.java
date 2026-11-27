package org.nuxeo.agentic.config;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What the diagnostics page says of a configuration message, cleaned of what looks like a secret or
 * personal data, because its "copy for support" text is made to be sent outside the company
 * ({@link DiagnosticsReport}).
 *
 * The configuration's own messages name files, components and bundles, and none is meant to carry
 * either; but a message may quote an exception's text, which may quote a path, an address or a
 * header. So, whatever the message:
 *
 * <ul>
 * <li>a URL keeps its scheme, host and path: who it signs in as and its query are dropped;</li>
 * <li>an email address is {@value #EMAIL};</li>
 * <li>a home directory's owner, in {@code /home/<name>}, {@code /Users/<name>} or {@code
 * C:\Users\<name>}, is {@value #USER};</li>
 * <li>what follows a credential's name, {@code password}, {@code secret}, {@code token}, an API or
 * access key and the like, then {@code =} or {@code :}, is {@value #SECRET}; and so are an {@code
 * Authorization} header's value and what follows {@code Basic} or {@code Bearer};</li>
 * <li>anything shaped like a key or a token is {@value #SECRET}: a run of {@value #TOKEN_LENGTH} or
 * more letters, digits, {@code _}, {@code -}, {@code +} or {@code =} with a digit and a letter in
 * it; or a run of {@value #BASE64_LENGTH} or more of base64's own alphabet, {@code /} included,
 * with a digit, a capital and a small letter in it;</li>
 * <li>a control character is a space, and the whole is at most {@value #MAX_LENGTH} characters.</li>
 * </ul>
 *
 * It does not make an arbitrary text safe to publish: it is the second line, after the server's
 * messages, which are written to name no person and no secret, and the page asks the administrator
 * to read the text before sending it. A version or a name the report gives as a value of its own is
 * not cleaned but held to {@link #identifier} or {@link #version}: the token rule would take a
 * build's timestamped version for a key.
 */
final class Redaction {

    static final String EMAIL = "[email]";

    static final String USER = "[user]";

    static final String SECRET = "[redacted]";

    static final int TOKEN_LENGTH = 24;

    static final int BASE64_LENGTH = 32;

    static final int MAX_LENGTH = 500;

    private static final Pattern EMAILS = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");

    /** A URL's scheme, who it signs in as, its host and path, and its query or fragment. */
    private static final Pattern URLS = Pattern.compile(
            "\\b([a-zA-Z][a-zA-Z0-9+.-]{1,15}://)(?:[^\\s/@?#]*@)?([^\\s/?#]+)([^\\s?#]*)(?:[?#]\\S*)?");

    private static final Pattern HOMES = Pattern.compile("(/home/|/Users/|[A-Za-z]:\\\\Users\\\\)[^/\\\\\\s]+");

    /** A credential's name, then {@code =} or {@code :}, then its value, to the next space, comma or quote. */
    private static final Pattern NAMED = Pattern.compile(
            "(?i)\\b((?:[a-z0-9]+[._-])?(?:password|passwd|pwd|secret|token|credential|api[._-]?key|access[._-]?key|"
                    + "private[._-]?key)s?)(\\s*[=:]\\s*)(?!\\[redacted\\])[^\\s,;\"']+");

    /**
     * An {@code Authorization} header's value, and a scheme's credential: one with a digit, {@code +},
     * {@code /} or {@code =} in it, so that "basic templates" stays as it is.
     */
    private static final Pattern SCHEMES = Pattern.compile("(?i)\\b(authorization\\s*:\\s*)(?:basic|bearer|digest|negotiate)?"
            + "\\s*[^\\s,;\"']+|\\b(basic|bearer)\\s+(?=[A-Za-z0-9._~+/=-]*[0-9+/=])[A-Za-z0-9._~+/=-]{8,}");

    private static final Pattern TOKENS = Pattern.compile(
            "(?<![A-Za-z0-9_+=-])(?=[A-Za-z0-9_+=-]*[0-9])(?=[A-Za-z0-9_+=-]*[A-Za-z])[A-Za-z0-9_+=-]{"
                    + TOKEN_LENGTH + ",}(?![A-Za-z0-9_+=-])");

    /** Base64's own alphabet, {@code /} included and no {@code -}, {@code _} or {@code .}, which a path has. */
    private static final Pattern BASE64 = Pattern.compile(
            "(?<![A-Za-z0-9+/=])(?=[A-Za-z0-9+/=]*[0-9])(?=[A-Za-z0-9+/=]*[A-Z])(?=[A-Za-z0-9+/=]*[a-z])[A-Za-z0-9+/=]{"
                    + BASE64_LENGTH + ",}(?![A-Za-z0-9+/=])");

    /** A package's or a module's name: letters, digits, {@code .}, {@code _}, {@code +} and {@code -}. */
    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._+-]{0,127}");

    /** A version, or a range of them as {@code app.json}'s {@code platform} writes one, or a product's name. */
    private static final Pattern VERSION = Pattern.compile("[A-Za-z0-9<>=^~][A-Za-z0-9 ._+<>=^~*|()-]{0,127}");

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
        text = SCHEMES.matcher(text).replaceAll(match -> Matcher.quoteReplacement(
                (match.group(1) != null ? match.group(1) : match.group(2) + " ") + SECRET));
        text = NAMED.matcher(text).replaceAll(match -> Matcher.quoteReplacement(match.group(1) + match.group(2) + SECRET));
        text = TOKENS.matcher(text).replaceAll(Matcher.quoteReplacement(SECRET));
        text = BASE64.matcher(text).replaceAll(Matcher.quoteReplacement(SECRET));
        if (text.codePointCount(0, text.length()) > MAX_LENGTH) {
            text = text.substring(0, text.offsetByCodePoints(0, MAX_LENGTH - 1)) + "…";
        }
        return text;
    }

    /** The value when it is a package's or a module's name, else {@code null}: never a cleaned guess. */
    static String identifier(String value) {
        return value != null && IDENTIFIER.matcher(value).matches() ? value : null;
    }

    /** The value when it is a version, a range of them or a product's name, else {@code null}. */
    static String version(String value) {
        if (value == null) {
            return null;
        }
        String stripped = value.strip();
        return VERSION.matcher(stripped).matches() ? stripped : null;
    }
}
