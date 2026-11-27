package org.nuxeo.agentic.config;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Pattern;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;

import org.w3c.dom.Element;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;

/**
 * The Marketplace packages installed on this server, as its package manager records them, for the
 * diagnostics page ({@link DiagnosticsReport}): read, never written.
 *
 * The package manager keeps, in its directory ({@code nuxeo.mp.dir}, {@code packages} below the
 * server's home by default), a {@code .packages} file of one line per package it knows, {@code
 * <id>=<state>}, and each package's {@code package.xml} in {@code store/<id>/}. The id joins the
 * name and the version with a hyphen, and both may hold hyphens, so the name and the version are
 * read from the {@code package.xml}'s root element rather than split from the id.
 *
 * <b>A package's signature.</b> Nuxeo LTS 2025's package manager records no signature: a package's
 * signature is verified by the administrator before {@code nuxeoctl mp-install}
 * (docs/business-apps/administrator-guide.md, section 3), and nothing on the server keeps the
 * result. So every package is reported {@value #SIGNATURE_NOT_RECORDED}, never "verified", which
 * the server could not back.
 *
 * Bounded: at most {@value #MAX_PACKAGES} packages, a {@code .packages} of at most {@value
 * #MAX_LIST_BYTES} bytes and a {@code package.xml} of at most {@value #MAX_XML_BYTES}, each limit held
 * as the file is read; an id that is not a plain file name is skipped, so that a line cannot point
 * the reader outside the store, and a {@code package.xml} that is not inside the store once its
 * links are followed is not read; neither file is read through a link of its own; and the XML is
 * parsed with no DTD and no external entity. Read for each request, not kept: at most 500 files of
 * 64 KB, for an administrator's page.
 */
final class InstalledPackages {

    /** What {@link Entry#signature} says for every package on Nuxeo LTS 2025. */
    static final String SIGNATURE_NOT_RECORDED = "not-recorded";

    static final String LIST = ".packages";

    static final String STORE = "store";

    static final int MAX_PACKAGES = 500;

    static final int MAX_LIST_BYTES = 256 * 1024;

    static final int MAX_XML_BYTES = 64 * 1024;

    /** The states a package is installed in: {@code started}, and {@code installed} until the restart. */
    static final Set<String> INSTALLED = Set.of("started", "installed");

    /** The platform package: the app itself, its client and {@code nuxeo-agentic-core}. */
    static final String PLATFORM_PACKAGE = "nuxeo-agentic-ui";

    private static final Pattern ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._+-]{0,199}");

    /**
     * One installed package.
     *
     * @param role {@code app} for the platform package, {@code kit} for a package that depends on it,
     *            and {@code add-on} for any other
     * @param signature {@value #SIGNATURE_NOT_RECORDED}: see the class
     */
    record Entry(String id, String name, String version, String state, String role, String signature) {
    }

    /**
     * What was read.
     *
     * @param recorded whether the package manager's list was there to read
     * @param problem why it could not be read whole, or {@code null}: {@code no-directory}, {@code
     *            no-list}, {@code list-too-large} or {@code list-unreadable}, with nothing listed; or,
     *            with what could be, {@code id-skipped}, {@code too-many} or {@code
     *            descriptor-unreadable}, the last of them met
     */
    record Listing(boolean recorded, List<Entry> packages, String problem) {

        Listing {
            packages = List.copyOf(packages);
        }

        static Listing notRecorded(String problem) {
            return new Listing(false, List.of(), problem);
        }
    }

    private InstalledPackages() {
    }

    /** The installed packages under {@code directory}, sorted by name; a directory of {@code null} records none. */
    static Listing read(Path directory) {
        if (directory == null) {
            return Listing.notRecorded("no-directory");
        }
        Path list = directory.resolve(LIST);
        if (!Files.isRegularFile(list, LinkOption.NOFOLLOW_LINKS)) {
            return Listing.notRecorded("no-list");
        }
        Properties states = new Properties();
        Path store;
        try {
            byte[] bytes = bounded(list, MAX_LIST_BYTES);
            if (bytes == null) {
                return Listing.notRecorded("list-too-large");
            }
            states.load(new StringReader(new String(bytes, StandardCharsets.UTF_8)));
            Path stored = directory.resolve(STORE);
            store = Files.isDirectory(stored) ? stored.toRealPath() : null;
        } catch (IOException | IllegalArgumentException e) {
            return Listing.notRecorded("list-unreadable");
        }
        List<Entry> packages = new ArrayList<>();
        String problem = null;
        for (String id : states.stringPropertyNames().stream().sorted().toList()) {
            String state = states.getProperty(id, "").strip().toLowerCase(Locale.ROOT);
            if (!INSTALLED.contains(state)) {
                continue;
            }
            if (!ID.matcher(id).matches() || id.contains("..")) {
                problem = "id-skipped";
                continue;
            }
            if (packages.size() == MAX_PACKAGES) {
                problem = "too-many";
                break;
            }
            Descriptor descriptor = store == null ? null : descriptor(store, id);
            String name = descriptor == null ? id : descriptor.name();
            packages.add(new Entry(id, name, descriptor == null ? null : descriptor.version(), state,
                    role(name, descriptor), SIGNATURE_NOT_RECORDED));
            if (descriptor == null) {
                problem = "descriptor-unreadable";
            }
        }
        packages.sort(Comparator.comparing(Entry::name).thenComparing(Entry::id));
        return new Listing(true, packages, problem);
    }

    private record Descriptor(String name, String version, List<String> dependencies) {
    }

    private static String role(String name, Descriptor descriptor) {
        if (PLATFORM_PACKAGE.equals(name)) {
            return "app";
        }
        if (descriptor != null && descriptor.dependencies()
                                            .stream()
                                            .anyMatch(dependency -> dependency.equals(PLATFORM_PACKAGE)
                                                    || dependency.startsWith(PLATFORM_PACKAGE + ":"))) {
            return "kit";
        }
        return "add-on";
    }

    /**
     * The file's bytes, read through no link and at most {@code limit} of them: {@code null} when it
     * holds more. Bounded as it is read, not by a size asked for first, which the file could outgrow.
     */
    private static byte[] bounded(Path file, int limit) throws IOException {
        try (InputStream in = Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) {
            byte[] bytes = in.readNBytes(limit + 1);
            return bytes.length > limit ? null : bytes;
        }
    }

    /**
     * A package's {@code package.xml} in the store: its name, version and dependencies, or {@code
     * null} when it cannot be read, is over its limit, or is not inside the store once every link on
     * its way is followed, so that a package's folder linked elsewhere is not read.
     */
    private static Descriptor descriptor(Path store, String id) {
        try {
            Path file = store.resolve(id).resolve("package.xml");
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || !file.toRealPath().startsWith(store)) {
                return null;
            }
            byte[] bytes = bounded(file, MAX_XML_BYTES);
            if (bytes == null) {
                return null;
            }
            Element root = parser().parse(new InputSource(new StringReader(new String(bytes, StandardCharsets.UTF_8))))
                                   .getDocumentElement();
            if (root == null || !"package".equals(root.getTagName())) {
                return null;
            }
            String name = root.getAttribute("name").strip();
            String version = root.getAttribute("version").strip();
            if (name.isEmpty()) {
                return null;
            }
            List<String> dependencies = new ArrayList<>();
            var nodes = root.getElementsByTagName("dependencies");
            for (int i = 0; i < nodes.getLength(); i++) {
                var children = ((Element) nodes.item(i)).getElementsByTagName("package");
                for (int j = 0; j < children.getLength(); j++) {
                    dependencies.add(children.item(j).getTextContent().strip());
                }
            }
            return new Descriptor(name, version.isEmpty() ? null : version, dependencies);
        } catch (IOException | SAXException | ParserConfigurationException | RuntimeException e) {
            return null;
        }
    }

    /**
     * A parser that reads no DTD and resolves no external entity or schema. A document with a
     * DOCTYPE is refused outright, which is what keeps an entity out, and a parser that cannot refuse
     * one is not used. The JAXP 1.5 attributes are set where the parser takes them: Nuxeo LTS 2025
     * ships Xerces 2.12 in {@code nxserver/lib}, whose factory, found first, does not.
     */
    private static DocumentBuilder parser() throws ParserConfigurationException {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        for (String attribute : List.of(XMLConstants.ACCESS_EXTERNAL_DTD, XMLConstants.ACCESS_EXTERNAL_SCHEMA)) {
            try {
                factory.setAttribute(attribute, "");
            } catch (IllegalArgumentException e) {
                // Not this parser's: the DOCTYPE refusal above already keeps every entity out.
            }
        }
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        factory.setNamespaceAware(false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        builder.setErrorHandler(null);
        return builder;
    }
}
