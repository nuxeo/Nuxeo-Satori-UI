/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

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
 * The providers registered at {@code providers}, each made once and given the server's settings;
 * the profiles registered at {@code profiles}, each checked ({@link Profile#of}); and the add-on's
 * filing claims, in the key/value store {@value #STORE}, the server's default one unless the server
 * configures one of that name.
 */
public class CaptureComponent extends DefaultComponent implements CaptureService {

    private static final Logger log = LogManager.getLogger(CaptureComponent.class);

    static final String STORE = "agentic-capture";

    private final Map<String, ProviderDescriptor> descriptors = new ConcurrentHashMap<>();

    private final Map<String, CaptureProvider> providers = new ConcurrentHashMap<>();

    private final Map<String, Profile> profiles = new ConcurrentHashMap<>();

    private final CaptureSettings settings = CaptureSettings.server();

    @Override
    public void registerContribution(Object contribution, String point, ComponentInstance contributor) {
        if ("providers".equals(point) && contribution instanceof ProviderDescriptor descriptor) {
            registerProvider(descriptor, contributor);
        } else if ("profiles".equals(point) && contribution instanceof ProfileDescriptor descriptor) {
            registerProfile(descriptor, contributor);
        }
    }

    private void registerProvider(ProviderDescriptor descriptor, ComponentInstance contributor) {
        String id = descriptor.getId();
        if (id == null || !Captures.PROVIDER_ID.matcher(id).matches()) {
            log.error("Capture: a provider's id must be 1 to 32 lower-case letters, digits and '-', starting with "
                    + "a letter; one from {} is not registered", contributor.getName());
            return;
        }
        providers.remove(id);
        if (!descriptor.isEnabled()) {
            descriptors.remove(id);
            return;
        }
        if (descriptor.getKlass() == null || !CaptureProvider.class.isAssignableFrom(descriptor.getKlass())) {
            log.error("Capture: the provider {} names no class implementing CaptureProvider; not registered", id);
            descriptors.remove(id);
            return;
        }
        descriptors.put(id, descriptor);
    }

    private void registerProfile(ProfileDescriptor descriptor, ComponentInstance contributor) {
        if (!descriptor.isEnabled()) {
            if (descriptor.getId() != null) {
                profiles.remove(descriptor.getId());
            }
            return;
        }
        Profile profile;
        try {
            profile = Profile.of(descriptor);
        } catch (Profile.InvalidProfileException e) {
            // Refused whole, and an earlier profile of the same id with it: a kit's change that
            // breaks a rule must not leave the profile it meant to replace capturing.
            if (descriptor.getId() != null) {
                profiles.remove(descriptor.getId());
            }
            log.error("Capture: the profile {} from {} is not registered: {}", descriptor.getId(),
                    contributor.getName(), e.getMessage());
            return;
        }
        for (Profile other : profiles.values()) {
            if (!other.id().equals(profile.id()) && other.inboxType().equals(profile.inboxType())
                    && other.itemType().equals(profile.itemType())) {
                log.error("Capture: the profile {} from {} is not registered: profile {} already captures {} in {}",
                        profile.id(), contributor.getName(), other.id(), profile.itemType(), profile.inboxType());
                profiles.remove(profile.id());
                return;
            }
        }
        profiles.put(profile.id(), profile);
    }

    @Override
    public void unregisterContribution(Object contribution, String point, ComponentInstance contributor) {
        if ("providers".equals(point) && contribution instanceof ProviderDescriptor descriptor
                && descriptor.getId() != null) {
            descriptors.remove(descriptor.getId());
            providers.remove(descriptor.getId());
        } else if ("profiles".equals(point) && contribution instanceof ProfileDescriptor descriptor
                && descriptor.getId() != null) {
            profiles.remove(descriptor.getId());
        }
    }

    @Override
    public CaptureProvider provider(String id) {
        if (id == null) {
            return null;
        }
        ProviderDescriptor descriptor = descriptors.get(id);
        if (descriptor == null) {
            return null;
        }
        return providers.computeIfAbsent(id, ignored -> {
            try {
                CaptureProvider provider = (CaptureProvider) descriptor.getKlass().getDeclaredConstructor().newInstance();
                provider.init(id, settings);
                return provider;
            } catch (ReflectiveOperationException | RuntimeException e) {
                log.error("Capture: the provider {} could not be made ({})", id, e.getClass().getSimpleName());
                return null;
            }
        });
    }

    @Override
    public String activeProviderId() {
        String id = settings.property(CaptureSettings.PROVIDER_PROPERTY);
        if (id == null || !descriptors.containsKey(id)) {
            return null;
        }
        CaptureProvider provider = provider(id);
        return provider != null && provider.configured() ? id : null;
    }

    @Override
    public CaptureProvider activeProvider() {
        String id = activeProviderId();
        return id == null ? null : provider(id);
    }

    @Override
    public Profile profile(String id) {
        return id == null ? null : profiles.get(id);
    }

    @Override
    public Profile profileFor(String inboxType, String itemType) {
        if (inboxType == null || itemType == null) {
            return null;
        }
        return profiles.values()
                       .stream()
                       .filter(p -> p.inboxType().equals(inboxType) && p.itemType().equals(itemType))
                       .findFirst()
                       .orElse(null);
    }

    @Override
    public boolean isItemType(String itemType) {
        return itemType != null && profiles.values().stream().anyMatch(p -> p.itemType().equals(itemType));
    }

    @Override
    public CaptureSettings settings() {
        return settings;
    }

    /**
     * Claim {@code key} for {@code ttlSeconds}, as {@code value}, released when the current
     * transaction does not commit; {@code false} when someone holds it already. No transaction to
     * release it with, no claim: one that could outlive a rolled-back filing would hold the item
     * until it expired.
     */
    boolean claim(String key, String value, long ttlSeconds) {
        KeyValueStore store = store();
        AtomicBoolean claimed = new AtomicBoolean();
        if (!TransactionSynchronizations.unlessCommitted(() -> {
            if (claimed.get()) {
                store.compareAndSet(key, value, null);
            }
        })) {
            throw new NuxeoException("Capture: no transaction to claim " + key + " in");
        }
        if (!store.compareAndSet(key, null, value, ttlSeconds)) {
            return false;
        }
        claimed.set(true);
        return true;
    }

    /** Who holds {@code key}: the value it was claimed as, or {@code null} when no one does. */
    String claimed(String key) {
        return store().getString(key);
    }

    private static KeyValueStore store() {
        return Framework.getService(KeyValueService.class).getKeyValueStore(STORE);
    }
}
