package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.connectors.WebhookSender.Outcome;

/**
 * The add-on's own signer and sender, {@link WebhookComponent#signed} and {@link WebhookSender},
 * delivering to the demo's stand-in receiver, {@code demo/webhook-receiver.mjs}, run with Node: a
 * receiver written apart from the add-on, in another language, takes what it sends, and refuses it
 * signed with another secret. Skipped where Node is not on the path; the build-marketplace job
 * has it.
 */
class WebhookReceiverInteropTest {

    private static final String WEBHOOK = "payers.claimUpdates";

    private Process receiver;

    private String address;

    private final List<String> log = new CopyOnWriteArrayList<>();

    private final String secret = Fixtures.generatedSecret();

    @BeforeEach
    void start() throws Exception {
        Assumptions.assumeTrue(nodeAvailable(), "node is not on the path: the stand-in receiver is not run");
        ProcessBuilder builder = new ProcessBuilder("node", Path.of("demo", "webhook-receiver.mjs").toString(),
                "--port", "0", "--webhook", WEBHOOK).redirectErrorStream(true);
        builder.environment().put("WEBHOOK_SECRET", secret);
        receiver = builder.start();
        BufferedReader out = new BufferedReader(new InputStreamReader(receiver.getInputStream(), StandardCharsets.UTF_8));
        Pattern started = Pattern.compile("on (http://[^ ]+/nuxeo-webhooks)");
        long deadline = System.currentTimeMillis() + 10_000;
        while (address == null && System.currentTimeMillis() < deadline) {
            String line = out.readLine();
            if (line == null) {
                break;
            }
            Matcher matcher = started.matcher(line);
            if (matcher.find()) {
                address = matcher.group(1);
            }
        }
        assertNotNull(address, "the stand-in receiver did not start");
        Thread drain = new Thread(() -> {
            try {
                for (String line; (line = out.readLine()) != null;) {
                    log.add(line);
                }
            } catch (IOException e) {
                // The receiver stopped.
            }
        });
        drain.setDaemon(true);
        drain.start();
    }

    @AfterEach
    void stop() {
        if (receiver != null) {
            receiver.destroy();
        }
    }

    private static boolean nodeAvailable() {
        try {
            Process node = new ProcessBuilder("node", "--version").redirectErrorStream(true).start();
            return node.waitFor(10, TimeUnit.SECONDS) && node.exitValue() == 0;
        } catch (IOException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private WebhookSender.Result deliver(String signingSecret, String delivery) {
        byte[] body = ("{\"delivery\":\"" + delivery + "\",\"event\":\"modified\",\"document\":{\"id\":"
                + "\"1f0b7a52-0000-4000-8000-000000000130\",\"type\":\"Claim\"},\"fields\":{\"claimNumber\":"
                + "\"CLAIM-000130\"}}").getBytes(StandardCharsets.UTF_8);
        String nonce = java.util.HexFormat.of().formatHex(Fixtures.generatedSecret().substring(0, 16)
                                                                 .getBytes(StandardCharsets.US_ASCII));
        WebhookSender sender = new WebhookSender(InetAddress::getAllByName,
                javax.net.ssl.HttpsURLConnection.getDefaultSSLSocketFactory());
        return sender.send(WebhookSender.target(address, true), true,
                WebhookComponent.signed(WEBHOOK, signingSecret, Long.toString(Instant.now().getEpochSecond()), nonce,
                        body),
                body, Duration.ofSeconds(2), Duration.ofSeconds(5));
    }

    @Test
    void theStandInReceiverTakesWhatTheAddOnSignsAndRefusesAnotherSecret() throws Exception {
        String delivery = Fixtures.generatedSecret().substring(0, 32);
        assertEquals(new WebhookSender.Result(Outcome.DELIVERED, 204, null), deliver(secret, delivery));
        WebhookSender.Result forged = deliver(Fixtures.generatedSecret(), Fixtures.generatedSecret().substring(0, 32));
        assertEquals(Outcome.REJECTED, forged.outcome());
        assertEquals(401, forged.status());
        long deadline = System.currentTimeMillis() + 5_000;
        while (log.size() < 2 && System.currentTimeMillis() < deadline) {
            Thread.sleep(20);
        }
        assertTrue(log.stream().anyMatch(line -> line.contains("204 accepted " + delivery + " modified of a Claim")),
                String.join("\n", log));
        assertTrue(log.stream().anyMatch(line -> line.contains("401 bad-signature")), String.join("\n", log));
    }
}
