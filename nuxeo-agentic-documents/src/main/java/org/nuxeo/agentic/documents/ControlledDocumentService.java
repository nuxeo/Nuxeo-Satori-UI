/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.util.List;

/**
 * The number series packages contribute, and the numbers given from them.
 */
public interface ControlledDocumentService {

    /** The series in force with this id, or {@code null} when none is registered. */
    NumberSeries series(String id);

    /**
     * The next number of a series, from the platform's sequencer: the one the configuration
     * property {@value ControlledDocumentComponent#SEQUENCER_PROPERTY} names, or the platform's
     * default one. Each call takes a value no other call is given, and none is given back: a
     * number taken by a transaction that rolls back is never given again, and leaves a gap.
     */
    String nextNumber(NumberSeries series);

    /**
     * Claim the right to supersede a revision, for the new revision with that id, across the
     * cluster: {@code true} for the one transaction that claims it, {@code false} for any other
     * while the claim holds. The repository does not refuse two transactions writing the same
     * document at once (the last write wins), so this is what keeps a revision from being
     * superseded twice. The claim is released if the transaction does not commit, and expires
     * otherwise, once no transaction that could have read the revision as current is still open.
     */
    boolean claimSupersession(String previousId, String revisionId);

    /**
     * Claim {@code key} for {@code value} across the cluster, as a supersession is claimed:
     * {@code true} for the one transaction that claims it, {@code false} for any other while the
     * claim holds. Released if the transaction does not commit, and kept otherwise until it
     * expires, or {@link #releaseOnCommit} releases it.
     */
    boolean claim(String key, String value);

    /** Release {@code key}'s claim by {@code value} once the current transaction commits. */
    void releaseOnCommit(String key, String value);

    /**
     * Enter a review cycle's fence to write one of its comments, until the current transaction
     * ends: {@code false}, and nothing entered, when the cycle is being closed or has closed.
     * While one transaction is in, no close is let through ({@link #closeCycle}).
     */
    boolean enterCycle(String cycleId);

    /**
     * Take a review cycle's fence to close it: {@code false} while one of its comments is being
     * written, or another close is under way. Taken, no comment is written in the cycle until the
     * transaction ends; committed, none is for as long as a transaction that read the cycle open
     * could still run, after which the cycle's own status refuses one.
     */
    boolean closeCycle(String cycleId);

    /** The series registered for transmittals, by id: exactly one numbers them. */
    List<NumberSeries> transmittalSeries();
}
