/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.kv.KeyValueService;
import org.nuxeo.runtime.kv.KeyValueStore;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * The providers registered at {@code providers}, each made once and given the server's settings,
 * and the add-on's claims, in the key/value store {@value #STORE}, the server's default one unless
 * the server configures one of that name.
 */
public class SignatureComponent extends DefaultComponent implements SignatureService {

    private static final Logger log = LogManager.getLogger(SignatureComponent.class);

    static final String STORE = "agentic-signature";

    static final String WINDOW_PROPERTY = "nuxeo.agentic.signature.callback.window";

    static final long DEFAULT_WINDOW_SECONDS = 300;

    private final Map<String, ProviderDescriptor> descriptors = new ConcurrentHashMap<>();

    private final Map<String, SignatureProvider> providers = new ConcurrentHashMap<>();

    private volatile SignatureSettings settings = SignatureSettings.server();

    @Override
    public void registerContribution(Object contribution, String point, ComponentInstance contributor) {
        if (!"providers".equals(point) || !(contribution instanceof ProviderDescriptor descriptor)) {
            return;
        }
        String id = descriptor.getId();
        if (id == null || !Signatures.PROVIDER_ID.matcher(id).matches()) {
            log.error("E-signature: a provider's id must be 1 to 32 lower-case letters, digits and '-', starting "
                    + "with a letter; one from {} is not registered", contributor.getName());
            return;
        }
        providers.remove(id);
        if (!descriptor.isEnabled()) {
            descriptors.remove(id);
            return;
        }
        if (descriptor.getKlass() == null || !SignatureProvider.class.isAssignableFrom(descriptor.getKlass())) {
            log.error("E-signature: the provider {} names no class implementing SignatureProvider; not registered", id);
            descriptors.remove(id);
            return;
        }
        descriptors.put(id, descriptor);
    }

    @Override
    public void unregisterContribution(Object contribution, String point, ComponentInstance contributor) {
        if ("providers".equals(point) && contribution instanceof ProviderDescriptor descriptor
                && descriptor.getId() != null) {
            descriptors.remove(descriptor.getId());
            providers.remove(descriptor.getId());
        }
    }

    @Override
    public SignatureProvider provider(String id) {
        if (id == null) {
            return null;
        }
        ProviderDescriptor descriptor = descriptors.get(id);
        if (descriptor == null) {
            return null;
        }
        return providers.computeIfAbsent(id, ignored -> {
            try {
                SignatureProvider provider = (SignatureProvider) descriptor.getKlass().getDeclaredConstructor().newInstance();
                provider.init(id, settings);
                return provider;
            } catch (ReflectiveOperationException | RuntimeException e) {
                log.error("E-signature: the provider {} could not be made ({})", id, e.getClass().getSimpleName());
                return null;
            }
        });
    }

    @Override
    public String activeProviderId() {
        String id = settings.property(SignatureSettings.PROVIDER_PROPERTY);
        return id != null && descriptors.containsKey(id) ? id : null;
    }

    @Override
    public Duration callbackWindow() {
        String value = settings.property(WINDOW_PROPERTY);
        long seconds = DEFAULT_WINDOW_SECONDS;
        if (value != null) {
            try {
                seconds = Long.parseLong(value);
            } catch (NumberFormatException e) {
                seconds = DEFAULT_WINDOW_SECONDS;
            }
        }
        if (seconds < 30 || seconds > 3600) {
            seconds = DEFAULT_WINDOW_SECONDS;
        }
        return Duration.ofSeconds(seconds);
    }

    @Override
    public boolean claim(String key, String value, long ttlSeconds, boolean releaseUnlessCommitted) {
        KeyValueStore store = store();
        if (!releaseUnlessCommitted) {
            return store.compareAndSet(key, null, value, ttlSeconds);
        }
        // The release first, then the claim: a claim whose release could not be registered would
        // outlive its transaction and hold what it claims until it expired. So no release, no claim.
        AtomicBoolean claimed = new AtomicBoolean();
        if (!TransactionSynchronizations.unlessCommitted(() -> {
            if (claimed.get()) {
                store.compareAndSet(key, value, null);
            }
        })) {
            throw new NuxeoException("E-signature: no transaction to claim " + key + " in");
        }
        if (!store.compareAndSet(key, null, value, ttlSeconds)) {
            return false;
        }
        claimed.set(true);
        return true;
    }

    @Override
    public void release(String key) {
        store().put(key, (String) null);
    }

    @Override
    public String claimed(String key) {
        return store().getString(key);
    }

    @Override
    public void reclaim(String key, String value, long ttlSeconds) {
        store().put(key, value, ttlSeconds);
    }

    private static KeyValueStore store() {
        return Framework.getService(KeyValueService.class).getKeyValueStore(STORE);
    }

    /** For tests: the settings every provider is given from now on, each made again. */
    void useSettings(SignatureSettings settings) {
        this.settings = settings;
        providers.clear();
    }

    SignatureSettings settings() {
        return settings;
    }
}
