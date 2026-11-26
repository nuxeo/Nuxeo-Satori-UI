/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.RunnerFeature;

/**
 * The add-on as {@link ControlledDocumentsFeature} runs it, with what export-control marks need of
 * the platform besides: the user manager and its test directories, where recipients and groups are
 * looked up, and the platform's audit, which each change of a mark is written to. The download
 * service, whose permissions the add-on contributes one to, is the core's, deployed already.
 */
@Features({ ControlledDocumentsFeature.class, DocumentsAuditFeature.class })
public class ExportMarksFeature implements RunnerFeature {
}
