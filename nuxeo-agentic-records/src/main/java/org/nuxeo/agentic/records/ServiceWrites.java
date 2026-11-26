package org.nuxeo.agentic.records;

import java.util.function.Supplier;

/**
 * The add-on's own writes to its documents, which {@link DispositionListener} lets through: they
 * are made in this thread, inside {@link #run}, and no one else's are.
 */
final class ServiceWrites {

    private static final ThreadLocal<int[]> DEPTH = ThreadLocal.withInitial(() -> new int[1]);

    static boolean active() {
        return DEPTH.get()[0] > 0;
    }

    static <R> R run(Supplier<R> write) {
        int[] depth = DEPTH.get();
        depth[0]++;
        try {
            return write.get();
        } finally {
            if (--depth[0] == 0) {
                DEPTH.remove();
            }
        }
    }

    static void run(Runnable write) {
        run(() -> {
            write.run();
            return null;
        });
    }

    private ServiceWrites() {
    }
}
