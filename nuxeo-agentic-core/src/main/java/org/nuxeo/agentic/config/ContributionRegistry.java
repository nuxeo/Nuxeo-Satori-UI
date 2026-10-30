package org.nuxeo.agentic.config;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Contributions in the order Nuxeo registered them, and the set in force after replacements and
 * removals.
 *
 * Nuxeo registers a component's contributions only after every component it {@code <require>}s, so
 * registration order is dependency order: ours first, then a customer package that requires ours,
 * then a partner package that requires the customer's. The browser applies the fragments in that
 * order, so a later one wins key by key.
 *
 * Every contribution is kept, and the set in force is recomputed from scratch, so withdrawing one
 * (a hot reload in dev mode) gives the same result as never having registered it.
 *
 * A contribution's body is read and checked before it may replace anything: a replacement that
 * cannot be read, is too large or does not parse is rejected, and the one it named stays in force
 * where it was.
 */
final class ContributionRegistry {

    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");

    private static final Pattern TYPE = Pattern.compile("[A-Za-z][A-Za-z0-9_-]{0,127}");

    private static final Pattern MODE = Pattern.compile("[a-z][a-z0-9-]{0,31}");

    /** Image types only: an asset is served from our origin, so nothing a browser would run. */
    static final Pattern ASSET_NAME = Pattern.compile(
            "[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?:\\.[A-Za-z0-9_-]{1,32}){0,3}\\.(?i:svg|png|jpg|jpeg|gif|webp|ico)");

    private final List<Contribution> contributions = new ArrayList<>();

    synchronized void add(Contribution contribution) {
        contributions.add(contribution);
    }

    /** Withdraws the contribution made with this exact descriptor, if any. */
    synchronized boolean remove(Object descriptor) {
        return contributions.removeIf(contribution -> contribution.descriptor() == descriptor);
    }

    /** The contributions in force, in order, and what happened to the others. */
    synchronized Resolution resolve() {
        Map<String, ConfigSnapshot.Loaded> inForce = new LinkedHashMap<>();
        List<Diagnostic> diagnostics = new ArrayList<>();
        for (Contribution contribution : contributions) {
            String invalid = validate(contribution);
            if (invalid != null) {
                diagnostics.add(Diagnostic.error("invalid-contribution", contribution.scope(),
                        contribution.provenance(), invalid));
                continue;
            }
            String key = contribution.key();
            ConfigSnapshot.Loaded loadedPrevious = inForce.get(key);
            Contribution previous = loadedPrevious == null ? null : loadedPrevious.contribution();
            if (!contribution.enabled()) {
                if (previous == null) {
                    diagnostics.add(Diagnostic.warning("disabled-nothing", contribution.scope(),
                            contribution.provenance(),
                            String.format("%s is disabled, but no earlier contribution has that %s.", key,
                                    contribution.kind() == Contribution.Kind.LAYOUT ? "type and mode" : "name")));
                } else {
                    inForce.remove(key);
                    diagnostics.add(displacement(previous, contribution, "removed", "removed-packaged-default",
                            String.format("%s from %s is removed by %s.", key, describe(previous.provenance()),
                                    describe(contribution.provenance()))));
                }
                continue;
            }
            ConfigSnapshot.Loaded loaded = ConfigSnapshot.load(contribution, diagnostics);
            if (loaded == null) {
                if (previous != null) {
                    diagnostics.add(Diagnostic.warning("kept", contribution.scope(), previous.provenance(),
                            String.format("%s from %s stays in force: its replacement from %s was rejected.", key,
                                    describe(previous.provenance()), describe(contribution.provenance()))));
                }
                continue;
            }
            if (previous != null) {
                // `put` on an existing key keeps its position: a replacement takes the place of the
                // fragment it replaces rather than jumping over everything registered in between.
                diagnostics.add(displacement(previous, contribution, "replaced", "replaced-packaged-default",
                        String.format("%s from %s is replaced by %s.", key, describe(previous.provenance()),
                                describe(contribution.provenance()))));
            }
            inForce.put(key, loaded);
        }
        return new Resolution(List.copyOf(inForce.values()), List.copyOf(diagnostics));
    }

    /**
     * One contribution displacing another: a replacement, or a removal by a disabled contribution.
     *
     * Displacing another package's contribution is ordinary layering — that is what the ordering
     * and the disable flag are for — so it stays {@code info}. Displacing something <em>we</em>
     * packaged is almost never deliberate: the customer loses documented product behaviour, and
     * before NXSAT-747 the only trace was an {@code info}, which nobody greps {@code server.log}
     * for. That case is a {@code warning}, and carries its own code so a consumer can recognise it
     * without matching on prose.
     *
     * The message is deliberately the same either way: it already names what was displaced and who
     * displaced it, and two wordings would be two things to keep in step.
     *
     * @param displaced what was in force on this key until now
     * @param by the contribution taking or clearing the key
     */
    private static Diagnostic displacement(Contribution displaced, Contribution by, String code,
            String packagedCode, String message) {
        return displaced.provenance().isPackaged()
                ? Diagnostic.warning(packagedCode, by.scope(), by.provenance(), message)
                : Diagnostic.info(code, by.scope(), by.provenance(), message);
    }

    /** Why a contribution cannot be used, or {@code null} when it can. */
    static String validate(Contribution contribution) {
        switch (contribution.kind()) {
        case FRAGMENT:
            if (!ConfigScope.isFragmentLayer(contribution.layer())) {
                return String.format("fragment \"%s\" has layer \"%s\"; it must be \"bootstrap\" or \"manifest\".",
                        contribution.name(), contribution.layer());
            }
            if (contribution.name() == null || !NAME.matcher(contribution.name()).matches()) {
                return String.format("fragment name \"%s\" must be letters, digits, '.', '_' or '-'.",
                        contribution.name());
            }
            break;
        case LAYOUT:
            if (contribution.type() == null || !TYPE.matcher(contribution.type()).matches()) {
                return String.format("layout type \"%s\" is not a document type name.", contribution.type());
            }
            if (contribution.mode() == null || !MODE.matcher(contribution.mode()).matches()) {
                return String.format("layout mode \"%s\" must be lower-case letters, digits or '-'.",
                        contribution.mode());
            }
            break;
        case ASSET:
            if (contribution.name() == null || !ASSET_NAME.matcher(contribution.name()).matches()) {
                return String.format(
                        "asset name \"%s\" must be a plain file name ending in .svg, .png, .jpg, .jpeg, .gif, .webp or .ico.",
                        contribution.name());
            }
            break;
        default:
            return "unknown contribution kind";
        }
        if (contribution.enabled() && contribution.content() == null) {
            return String.format("%s has neither a src nor inline JSON.", contribution.key());
        }
        return null;
    }

    static String describe(Provenance provenance) {
        return String.format("%s (bundle %s)", provenance.component(), provenance.bundle());
    }

    record Resolution(List<ConfigSnapshot.Loaded> inForce, List<Diagnostic> diagnostics) {
    }
}
