/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.IOException;
import java.io.InputStream;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.impl.blob.AbstractBlob;

/**
 * A kept copy's file as {@code Asset.GetWatermarked} hands it over, since 0.6.0: its bytes, read from
 * the blob store as they are sent, under no key of the store's. The download permission refuses a
 * copy's stored file wherever it is asked for, by its document or by its key, so that no other path
 * serves it; this one has decided the rights, and the copy's key, for the person asking.
 */
final class ServedCopy extends AbstractBlob {

    private static final long serialVersionUID = 1L;

    private final transient Blob stored;

    ServedCopy(Blob stored) {
        this.stored = stored;
        setMimeType(stored.getMimeType());
        setEncoding(stored.getEncoding());
        setFilename(stored.getFilename());
        setDigest(stored.getDigest());
    }

    @Override
    public InputStream getStream() throws IOException {
        return stored.getStream();
    }

    @Override
    public long getLength() {
        return stored.getLength();
    }
}
