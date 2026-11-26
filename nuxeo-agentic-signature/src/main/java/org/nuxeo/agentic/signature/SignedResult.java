/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

/**
 * What comes back once an envelope is signed: the signed file, and the provider's evidence of the
 * signing, such as its certificate of completion, each as the provider's service gave it.
 */
public record SignedResult(String fileName, String mimeType, byte[] content, String evidenceName,
        String evidenceMimeType, byte[] evidence) {

    @Override
    public String toString() {
        return "SignedResult[" + content.length + " bytes, evidence " + evidence.length + " bytes]";
    }
}
