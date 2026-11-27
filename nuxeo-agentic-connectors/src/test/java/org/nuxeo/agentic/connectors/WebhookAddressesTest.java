package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.InetAddress;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.connectors.WebhookAddresses.Kind;

/**
 * Which addresses a webhook may send to, judged on the address, each family's ranges and the IPv6
 * forms that carry an IPv4 address. Literals only: nothing here asks the DNS.
 */
class WebhookAddressesTest {

    private static Kind kind(String literal) throws Exception {
        return WebhookAddresses.kind(InetAddress.getByName(literal));
    }

    @Test
    void eachRangeIsTheKindItIs() throws Exception {
        Map<String, Kind> expected = new java.util.LinkedHashMap<>();
        expected.put("93.184.215.14", Kind.PUBLIC);
        expected.put("8.8.8.8", Kind.PUBLIC);
        expected.put("172.15.255.255", Kind.PUBLIC);
        expected.put("172.32.0.1", Kind.PUBLIC);
        expected.put("100.63.255.255", Kind.PUBLIC);
        expected.put("100.128.0.1", Kind.PUBLIC);
        expected.put("10.0.0.5", Kind.PRIVATE);
        expected.put("172.16.0.1", Kind.PRIVATE);
        expected.put("172.31.255.255", Kind.PRIVATE);
        expected.put("192.168.65.254", Kind.PRIVATE);
        expected.put("100.64.0.1", Kind.PRIVATE);
        expected.put("127.0.0.1", Kind.LOOPBACK);
        expected.put("127.255.255.254", Kind.LOOPBACK);
        expected.put("169.254.169.254", Kind.LINK_LOCAL);
        expected.put("0.0.0.0", Kind.UNSPECIFIED);
        expected.put("0.1.2.3", Kind.RESERVED);
        expected.put("192.0.2.10", Kind.RESERVED);
        expected.put("198.51.100.10", Kind.RESERVED);
        expected.put("203.0.113.10", Kind.RESERVED);
        expected.put("198.18.0.1", Kind.RESERVED);
        expected.put("192.0.0.8", Kind.RESERVED);
        expected.put("224.0.0.1", Kind.MULTICAST);
        expected.put("239.255.255.250", Kind.MULTICAST);
        expected.put("240.0.0.1", Kind.RESERVED);
        expected.put("255.255.255.255", Kind.RESERVED);
        expected.put("2606:4700:4700::1111", Kind.PUBLIC);
        expected.put("::1", Kind.LOOPBACK);
        expected.put("::", Kind.UNSPECIFIED);
        expected.put("fe80::1", Kind.LINK_LOCAL);
        expected.put("febf::1", Kind.LINK_LOCAL);
        expected.put("fd00:ec2::254", Kind.PRIVATE);
        expected.put("fc00::1", Kind.PRIVATE);
        expected.put("fec0::1", Kind.PRIVATE);
        expected.put("ff02::1", Kind.MULTICAST);
        expected.put("2001:db8::1", Kind.RESERVED);
        expected.put("2001:0:4136:e378:8000:63bf:3fff:fdd2", Kind.RESERVED);
        expected.put("100::1", Kind.RESERVED);
        expected.put("4000::1", Kind.RESERVED);
        // IPv6 that carries IPv4: judged by the IPv4 address.
        expected.put("::ffff:127.0.0.1", Kind.LOOPBACK);
        expected.put("::ffff:169.254.169.254", Kind.LINK_LOCAL);
        expected.put("::ffff:10.1.2.3", Kind.PRIVATE);
        expected.put("::ffff:8.8.8.8", Kind.PUBLIC);
        expected.put("::127.0.0.1", Kind.LOOPBACK);
        expected.put("64:ff9b::a9fe:a9fe", Kind.LINK_LOCAL);
        expected.put("64:ff9b::7f00:1", Kind.LOOPBACK);
        expected.put("64:ff9b::808:808", Kind.PUBLIC);
        expected.put("2002:7f00:1::1", Kind.LOOPBACK);
        expected.put("2002:a9fe:a9fe::1", Kind.LINK_LOCAL);
        expected.put("2002:c0a8:101::1", Kind.PRIVATE);
        for (Map.Entry<String, Kind> each : expected.entrySet()) {
            assertEquals(each.getValue(), kind(each.getKey()), each.getKey());
        }
    }

    @Test
    void privateAndLoopbackOnlyWhereAllowedAndTheRestNever() {
        assertTrue(WebhookAddresses.allowed(Kind.PUBLIC, false));
        assertFalse(WebhookAddresses.allowed(Kind.PRIVATE, false));
        assertFalse(WebhookAddresses.allowed(Kind.LOOPBACK, false));
        assertTrue(WebhookAddresses.allowed(Kind.PRIVATE, true));
        assertTrue(WebhookAddresses.allowed(Kind.LOOPBACK, true));
        for (Kind never : new Kind[] { Kind.LINK_LOCAL, Kind.UNSPECIFIED, Kind.MULTICAST, Kind.RESERVED }) {
            assertFalse(WebhookAddresses.allowed(never, true), never.name());
            assertFalse(WebhookAddresses.allowed(never, false), never.name());
        }
    }
}
