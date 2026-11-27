package org.nuxeo.agentic.connectors;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;

/**
 * Which network addresses a webhook may send to, judged on the address a host name resolved to,
 * never on the name: a name, a redirect or a DNS answer cannot make a private address look public.
 *
 * <ul>
 * <li><b>Public:</b> always.</li>
 * <li><b>Private and loopback</b> ({@code 10/8}, {@code 172.16/12}, {@code 192.168/16}, the shared
 * {@code 100.64/10}, {@code 127/8}, {@code fc00::/7}, the old site-local {@code fec0::/10},
 * {@code ::1}): only where the server sets the webhook's {@link Webhook#privateAllowedProperty}.</li>
 * <li><b>Never:</b> link-local ({@code 169.254/16}, {@code fe80::/10}, where most cloud metadata
 * services answer), the metadata services that answer elsewhere ({@code 100.100.100.200}, inside the
 * shared {@code 100.64/10}, and {@code fd00:ec2::254}, inside {@code fc00::/7}), unspecified
 * ({@code 0.0.0.0}, {@code ::}), multicast and broadcast, and the reserved and documentation ranges,
 * which no receiver should be on.</li>
 * </ul>
 *
 * An IPv6 address that carries an IPv4 one, mapped ({@code ::ffff:a.b.c.d}), compatible
 * ({@code ::a.b.c.d}), NAT64 ({@code 64:ff9b::/96}) or 6to4 ({@code 2002::/16}), is judged by the IPv4
 * address it carries. Teredo ({@code 2001::/32}) hides its target, and is refused.
 */
final class WebhookAddresses {

    /** What an address is, for the decision and the log. */
    enum Kind {
        PUBLIC, PRIVATE, LOOPBACK, LINK_LOCAL, METADATA, UNSPECIFIED, MULTICAST, RESERVED;

        /** The name in the log and the audit. */
        String label() {
            return name().toLowerCase(java.util.Locale.ROOT).replace('_', '-');
        }
    }

    private WebhookAddresses() {
    }

    /** Whether a webhook may send to an address of this kind. */
    static boolean allowed(Kind kind, boolean privateAllowed) {
        return switch (kind) {
        case PUBLIC -> true;
        case PRIVATE, LOOPBACK -> privateAllowed;
        default -> false;
        };
    }

    static Kind kind(InetAddress address) {
        if (address instanceof Inet4Address) {
            return kind4(address.getAddress());
        }
        if (address instanceof Inet6Address) {
            return kind6(address.getAddress());
        }
        return Kind.RESERVED;
    }

    private static Kind kind4(byte[] a) {
        int b0 = a[0] & 0xff;
        int b1 = a[1] & 0xff;
        int b2 = a[2] & 0xff;
        if (b0 == 0) {
            return a[1] == 0 && a[2] == 0 && a[3] == 0 ? Kind.UNSPECIFIED : Kind.RESERVED;
        }
        if (b0 == 10) {
            return Kind.PRIVATE;
        }
        if (b0 == 100 && b1 == 100 && b2 == 100 && (a[3] & 0xff) == 200) {
            // A cloud's metadata service, inside the shared range below.
            return Kind.METADATA;
        }
        if (b0 == 100 && b1 >= 64 && b1 <= 127) {
            return Kind.PRIVATE;
        }
        if (b0 == 127) {
            return Kind.LOOPBACK;
        }
        if (b0 == 169 && b1 == 254) {
            return Kind.LINK_LOCAL;
        }
        if (b0 == 172 && b1 >= 16 && b1 <= 31) {
            return Kind.PRIVATE;
        }
        if (b0 == 192 && b1 == 168) {
            return Kind.PRIVATE;
        }
        // 192.0.0/24 (protocol assignments), 192.0.2/24, 198.51.100/24, 203.0.113/24 (documentation),
        // 192.88.99/24 (the old 6to4 relays), 198.18/15 (benchmarking).
        if ((b0 == 192 && b1 == 0 && (b2 == 0 || b2 == 2)) || (b0 == 192 && b1 == 88 && b2 == 99)
                || (b0 == 198 && (b1 == 18 || b1 == 19)) || (b0 == 198 && b1 == 51 && b2 == 100)
                || (b0 == 203 && b1 == 0 && b2 == 113)) {
            return Kind.RESERVED;
        }
        if (b0 >= 224 && b0 <= 239) {
            return Kind.MULTICAST;
        }
        if (b0 >= 240) {
            // 240/4, and 255.255.255.255, the broadcast address.
            return Kind.RESERVED;
        }
        return Kind.PUBLIC;
    }

    private static Kind kind6(byte[] a) {
        if (allZero(a, 0, 16)) {
            return Kind.UNSPECIFIED;
        }
        if (allZero(a, 0, 15) && a[15] == 1) {
            return Kind.LOOPBACK;
        }
        // ::ffff:a.b.c.d, mapped, and ::a.b.c.d, the deprecated compatible form.
        if (allZero(a, 0, 10) && ((a[10] & 0xff) == 0xff && (a[11] & 0xff) == 0xff || a[10] == 0 && a[11] == 0)) {
            return kind4(new byte[] { a[12], a[13], a[14], a[15] });
        }
        int w0 = ((a[0] & 0xff) << 8) | (a[1] & 0xff);
        int w1 = ((a[2] & 0xff) << 8) | (a[3] & 0xff);
        // 64:ff9b::/96, NAT64: the IPv4 address is in the last four bytes.
        if (w0 == 0x0064 && w1 == 0xff9b && allZero(a, 4, 12)) {
            return kind4(new byte[] { a[12], a[13], a[14], a[15] });
        }
        // 2002::/16, 6to4: the IPv4 address is in bytes 2 to 5.
        if (w0 == 0x2002) {
            return kind4(new byte[] { a[2], a[3], a[4], a[5] });
        }
        // 2001::/32, Teredo, and 2001:db8::/32, documentation.
        if (w0 == 0x2001 && (w1 == 0x0000 || w1 == 0x0db8)) {
            return Kind.RESERVED;
        }
        if ((a[0] & 0xff) == 0xff) {
            return Kind.MULTICAST;
        }
        if ((a[0] & 0xff) == 0xfe && (a[1] & 0xc0) == 0x80) {
            return Kind.LINK_LOCAL;
        }
        if ((a[0] & 0xff) == 0xfe && (a[1] & 0xc0) == 0xc0) {
            return Kind.PRIVATE;
        }
        if ((a[0] & 0xfe) == 0xfc) {
            // fd00:ec2::254, a cloud's metadata service, inside the unique local range.
            boolean metadata = w0 == 0xfd00 && w1 == 0x0ec2 && allZero(a, 4, 14) && (a[14] & 0xff) == 0x02
                    && (a[15] & 0xff) == 0x54;
            return metadata ? Kind.METADATA : Kind.PRIVATE;
        }
        // 100::/64, discard-only; and anything outside 2000::/3, the global unicast space.
        if (w0 == 0x0100 && w1 == 0 && allZero(a, 4, 8) || (a[0] & 0xe0) != 0x20) {
            return Kind.RESERVED;
        }
        return Kind.PUBLIC;
    }

    private static boolean allZero(byte[] a, int from, int to) {
        for (int i = from; i < to; i++) {
            if (a[i] != 0) {
                return false;
            }
        }
        return true;
    }
}
