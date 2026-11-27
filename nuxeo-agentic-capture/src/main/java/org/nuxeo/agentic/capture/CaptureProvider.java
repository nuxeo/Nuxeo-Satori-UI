/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.List;

import org.nuxeo.agentic.capture.Profile.CaptureClass;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * What classifies an item and extracts its fields, registered at {@code org.nuxeo.agentic.capture}'s
 * {@code providers}. The add-on keeps everything that does not depend on the provider: which
 * profile, the confidence rule, matching, filing, the person's part and the guards. A provider only
 * answers what an item is and what its fields say, each with a confidence from 0 to 1; whatever it
 * answers is checked again, and a value it gives is never a query, a path or an id.
 *
 * <p>A provider is called in the background, as the system, once the item's creation has committed,
 * and never in a person's request. It reads its settings from {@link CaptureSettings} only, under
 * {@code nuxeo.agentic.capture.<id>.}, never from a document. It throws
 * {@link CaptureProviderException} when it cannot answer; the item then waits for a person.
 */
public interface CaptureProvider {

    /** What a provider is given of an item: the system's session, the item, its file and its profile. */
    record Submission(CoreSession session, DocumentModel item, Blob file, Profile profile) {
    }

    /**
     * What the item is.
     *
     * @param className one of the profile's classes, or {@code null} when the provider cannot say
     * @param confidence from 0 to 1
     */
    record Classification(String className, double confidence) {
    }

    /** One value the provider read from the item, with its confidence, from 0 to 1. */
    record ExtractedField(String name, String value, double confidence) {
    }

    /** The values read, a field once at most. */
    record Extraction(List<ExtractedField> fields) {
    }

    /** Keeps its id and where its settings are read. */
    void init(String id, CaptureSettings settings);

    /** Whether the server has given it all it needs, and allows it to run. */
    boolean configured();

    Classification classify(Submission submission) throws CaptureProviderException;

    /** The fields of {@code captureClass}, read from the item. */
    Extraction extract(Submission submission, CaptureClass captureClass) throws CaptureProviderException;
}
