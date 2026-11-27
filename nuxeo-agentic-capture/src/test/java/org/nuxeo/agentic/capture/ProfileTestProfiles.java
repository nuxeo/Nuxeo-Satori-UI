/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.ArrayList;
import java.util.List;

/** The test contribution's profile, test-mail, written as a descriptor for the tests with no runtime. */
final class ProfileTestProfiles {

    private ProfileTestProfiles() {
    }

    static ProfileDescriptor withLetterAndInvoice() {
        ProfileDescriptor d = new ProfileDescriptor();
        d.id = "test-mail";
        d.inboxType = "TestInbox";
        d.itemType = "TestMail";
        d.recordType = "TestClaim";
        d.recordPath = "/desk";
        d.threshold = "0.85";
        d.classes = new ArrayList<>(List.of(
                captureClass("claimLetter", List.of("claim number", "policy number", "date of loss"),
                        field("claimNumber", "Claim number", "tclaim:number", "PC-[0-9]{5}"),
                        field("policyNumber", "Policy number", null, null),
                        field("lossDate", "Date of loss", null, "[0-9]{4}-[0-9]{2}-[0-9]{2}"),
                        field("sender", "From", null, null)),
                captureClass("invoice", List.of("invoice number", "amount due"),
                        field("invoiceNumber", "Invoice number", null, null))));
        return d;
    }

    private static ProfileDescriptor.ClassDescriptor captureClass(String name, List<String> keywords,
            ProfileDescriptor.FieldDescriptor... fields) {
        ProfileDescriptor.ClassDescriptor c = new ProfileDescriptor.ClassDescriptor();
        c.name = name;
        c.keywords = new ArrayList<>(keywords);
        c.fields = new ArrayList<>(List.of(fields));
        return c;
    }

    private static ProfileDescriptor.FieldDescriptor field(String name, String label, String match, String format) {
        ProfileDescriptor.FieldDescriptor f = new ProfileDescriptor.FieldDescriptor();
        f.name = name;
        f.label = label;
        f.match = match;
        f.format = format;
        return f;
    }
}
