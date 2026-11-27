/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;

/**
 * Stand-ins for the AI package's two operations, in the tests only: each counts its calls, keeps
 * the parameters it was given, and answers the JSON the test sets. Nothing here calls a service.
 */
public final class TestAiOperations {

    static final AtomicInteger CALLS = new AtomicInteger();

    static final List<Map<String, String>> GIVEN = Collections.synchronizedList(new ArrayList<>());

    static volatile String classifyAnswer = "{\"class\":\"claimLetter\",\"confidence\":0.93}";

    static volatile String extractAnswer = "{\"fields\":[{\"name\":\"claimNumber\",\"value\":\"PC-24001\",\"confidence\":0.95}]}";

    static volatile boolean fail;

    private TestAiOperations() {
    }

    static void reset() {
        CALLS.set(0);
        GIVEN.clear();
        classifyAnswer = "{\"class\":\"claimLetter\",\"confidence\":0.93}";
        extractAnswer = "{\"fields\":[{\"name\":\"claimNumber\",\"value\":\"PC-24001\",\"confidence\":0.95}]}";
        fail = false;
    }

    @Operation(id = "AI.CaptureClassify", category = "Test")
    public static class Classify {

        @Param(name = "docId")
        protected String docId;

        @Param(name = "classesJson")
        protected String classesJson;

        @OperationMethod
        public Blob run() {
            CALLS.incrementAndGet();
            GIVEN.add(Map.of("operation", "AI.CaptureClassify", "docId", docId, "classesJson", classesJson));
            if (fail) {
                throw new IllegalStateException("the model provider said: Rowan Vale, 12 Ashgrove Lane");
            }
            return Blobs.createJSONBlob(classifyAnswer);
        }
    }

    @Operation(id = "AI.CaptureExtract", category = "Test")
    public static class Extract {

        @Param(name = "docId")
        protected String docId;

        @Param(name = "class")
        protected String className;

        @Param(name = "fieldsJson")
        protected String fieldsJson;

        @OperationMethod
        public Blob run() {
            CALLS.incrementAndGet();
            GIVEN.add(Map.of("operation", "AI.CaptureExtract", "docId", docId, "class", className, "fieldsJson",
                    fieldsJson));
            return Blobs.createJSONBlob(extractAnswer);
        }
    }
}
