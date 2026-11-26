package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The package manager's records, as the diagnostics page reads them: read only, and bounded. */
class InstalledPackagesTest {

    private static void write(Path file, String text) throws IOException {
        Files.createDirectories(file.getParent());
        Files.writeString(file, text, StandardCharsets.UTF_8);
    }

    private static List<String> names(InstalledPackages.Listing listing) {
        return listing.packages().stream().map(InstalledPackages.Entry::name).toList();
    }

    @Test
    void theNameAndVersionComeFromEachPackagesDescriptorNotFromItsId(@TempDir Path root) throws IOException {
        // The id joins a name and a version that both hold hyphens.
        write(root.resolve(".packages"), "nuxeo-agentic-ui-2026.0.2-20261126114747-BUILD-local=started\n");
        write(root.resolve("store/nuxeo-agentic-ui-2026.0.2-20261126114747-BUILD-local/package.xml"),
                "<?xml version=\"1.0\"?>\n<package type=\"addon\" name=\"nuxeo-agentic-ui\" "
                        + "version=\"2026.0.2-20261126114747-BUILD-local\"><title>App</title></package>");

        InstalledPackages.Listing listing = InstalledPackages.read(root);

        assertTrue(listing.recorded());
        assertNull(listing.problem());
        InstalledPackages.Entry entry = listing.packages().get(0);
        assertEquals("nuxeo-agentic-ui", entry.name());
        assertEquals("2026.0.2-20261126114747-BUILD-local", entry.version());
        assertEquals("app", entry.role());
        assertEquals(InstalledPackages.SIGNATURE_NOT_RECORDED, entry.signature());
    }

    @Test
    void onlyInstalledPackagesAreListed(@TempDir Path root) throws IOException {
        write(root.resolve(".packages"), String.join("\n", "a-1.0.0=started", "b-1.0.0=installed", "c-1.0.0=downloaded",
                "d-1.0.0=installing", "e-1.0.0=removed"));
        for (String id : List.of("a-1.0.0", "b-1.0.0", "c-1.0.0", "d-1.0.0", "e-1.0.0")) {
            String name = id.substring(0, 1);
            write(root.resolve("store/" + id + "/package.xml"),
                    "<package name=\"" + name + "\" version=\"1.0.0\"/>");
        }

        assertEquals(List.of("a", "b"), names(InstalledPackages.read(root)));
    }

    @Test
    void aKitIsAPackageThatDependsOnTheApp(@TempDir Path root) throws IOException {
        write(root.resolve(".packages"), "brand-assets-demo-0.2.0=started\nnuxeo-agentic-assets-0.1.0=started\n");
        write(root.resolve("store/brand-assets-demo-0.2.0/package.xml"),
                "<package name=\"brand-assets-demo\" version=\"0.2.0\"><dependencies>"
                        + "<package>nuxeo-agentic-ui:2026.0.2</package><package>nuxeo-agentic-assets:0.1.0</package>"
                        + "</dependencies></package>");
        write(root.resolve("store/nuxeo-agentic-assets-0.1.0/package.xml"),
                "<package name=\"nuxeo-agentic-assets\" version=\"0.1.0\"/>");

        InstalledPackages.Listing listing = InstalledPackages.read(root);

        assertEquals("kit", listing.packages().get(0).role());
        assertEquals("add-on", listing.packages().get(1).role());
    }

    /** An id that is not a plain file name cannot point the reader outside the store. */
    @Test
    void anIdThatLeavesTheStoreIsSkipped(@TempDir Path root) throws IOException {
        Path outside = root.resolve("outside");
        write(outside.resolve("package.xml"), "<package name=\"stolen\" version=\"9\"/>");
        Path packages = root.resolve("packages");
        write(packages.resolve(".packages"), "..=started\n../outside=started\nok-1.0=started\n");
        write(packages.resolve("store/ok-1.0/package.xml"), "<package name=\"ok\" version=\"1.0\"/>");

        InstalledPackages.Listing listing = InstalledPackages.read(packages);

        assertEquals(List.of("ok"), names(listing));
        assertEquals("id-skipped", listing.problem());
    }

    /** No DTD is read, so no entity can pull a file in: the package is listed by its id alone. */
    @Test
    void aDescriptorWithADoctypeIsNotReadAndNoEntityIsResolved(@TempDir Path root) throws IOException {
        Path secret = root.resolve("secret.txt");
        write(secret, "not-for-the-page");
        write(root.resolve("p/.packages"), "evil-1.0=started\n");
        write(root.resolve("p/store/evil-1.0/package.xml"), "<?xml version=\"1.0\"?><!DOCTYPE package [<!ENTITY s SYSTEM \""
                + secret.toUri() + "\">]><package name=\"&s;\" version=\"1.0\"/>");

        InstalledPackages.Listing listing = InstalledPackages.read(root.resolve("p"));

        assertEquals("evil-1.0", listing.packages().get(0).name());
        assertNull(listing.packages().get(0).version());
        assertEquals("descriptor-unreadable", listing.problem());
        assertFalse(listing.toString().contains("not-for-the-page"));
    }

    @Test
    void aMissingOrOversizedListRecordsNothing(@TempDir Path root) throws IOException {
        assertEquals("no-directory", InstalledPackages.read(null).problem());
        assertEquals("no-list", InstalledPackages.read(root).problem());
        assertFalse(InstalledPackages.read(root).recorded());

        write(root.resolve(".packages"), "x".repeat(InstalledPackages.MAX_LIST_BYTES + 1));
        InstalledPackages.Listing big = InstalledPackages.read(root);
        assertFalse(big.recorded());
        assertEquals("list-too-large", big.problem());
        assertTrue(big.packages().isEmpty());
    }
}
