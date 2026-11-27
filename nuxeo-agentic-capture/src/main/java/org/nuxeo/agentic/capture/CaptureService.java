/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

/** The capture service: its providers and its profiles. */
public interface CaptureService {

    /** The provider registered under {@code id}, made once and given the server's settings, or {@code null}. */
    CaptureProvider provider(String id);

    /**
     * The provider the server names in {@value CaptureSettings#PROVIDER_PROPERTY}, when it is
     * registered and configured; otherwise {@code null}, and nothing is classified.
     */
    CaptureProvider activeProvider();

    /** Its id, as {@link #activeProvider} finds it, or {@code null}. */
    String activeProviderId();

    /** The profile of that id, or {@code null}. */
    Profile profile(String id);

    /** The profile that captures items of {@code itemType} in inboxes of {@code inboxType}, or {@code null}. */
    Profile profileFor(String inboxType, String itemType);

    /** Whether some profile captures items of {@code itemType}, in any inbox. */
    boolean isItemType(String itemType);

    CaptureSettings settings();
}
