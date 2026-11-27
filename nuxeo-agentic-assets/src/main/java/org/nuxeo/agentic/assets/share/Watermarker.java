/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageTypeSpecifier;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;

import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.ecm.core.api.Blob;

/**
 * The watermark a share link's bytes carry, drawn on the server: the picture decoded, the link's
 * text tiled across all of it at an angle, light over dark so that it shows on any picture, and
 * written again as a new JPEG. Nothing of the file but its pixels goes through: its metadata, its
 * colour profile and any other image it holds are left behind.
 *
 * <p>Refused, never passed through unmarked:
 * <ul>
 * <li>a file that is not a JPEG or a PNG, as ImageIO reads it;</li>
 * <li>a file of more than {@value #MAX_BYTES} bytes; a picture of more than {@value #MAX_PIXELS}
 * pixels, or with a side over {@value #MAX_SIDE}; one whose decoding and marking would take more
 * than {@value #MAX_DECODED_BYTES} bytes as {@link #decodedBytes} counts them, as a picture of 16
 * bits a channel would; or one whose tiles of text would be more than {@value #MAX_TILES}: each
 * read from its header before its pixels are, so that a small file claiming a huge picture is
 * refused before it takes memory or time;</li>
 * <li>a file ImageIO cannot decode, such as a CMYK JPEG, or text it cannot draw.</li>
 * </ul>
 * The file is read into memory and decoded from there, so the picture is never written to a
 * temporary file unmarked.
 */
public class Watermarker {

    /** 64 MiB. */
    public static final long MAX_BYTES = 64L * 1024 * 1024;

    /** A 6000 by 4000 picture. */
    public static final long MAX_PIXELS = 24_000_000L;

    /**
     * 200 MiB, as {@link #decodedBytes} counts it: the decoded picture, the marked copy at 4 bytes a
     * pixel, and the file twice. A 6000 by 4000 picture of 8 bits a channel, with or without alpha,
     * takes 168 to 192 MB and its file; of 16, 288 MB, refused.
     */
    public static final long MAX_DECODED_BYTES = 200L * 1024 * 1024;

    /**
     * The longest side a picture may have: a JPEG holds 65500 at most, and a long thin picture takes
     * many tiles, since they cover its diagonal at the font its shorter side sets.
     */
    public static final int MAX_SIDE = 16_384;

    /** The most times the text is drawn on one picture. */
    static final int MAX_TILES = 20_000;

    /** The bytes a pixel takes decoded when its reader does not say: the most any format here takes. */
    static final int UNKNOWN_BYTES_PER_PIXEL = 8;

    static final Set<String> FORMATS = Set.of("jpeg", "png");

    static final float QUALITY = 0.9f;

    /** Why a file was not marked. */
    public static final class WatermarkException extends Exception {

        private static final long serialVersionUID = 1L;

        /** What kind of file it was. */
        public enum Kind {
            /** Not a JPEG or a PNG, or one that cannot be decoded or drawn on. */
            NOT_AN_IMAGE,
            /** Over {@link #MAX_BYTES} bytes or {@link #MAX_PIXELS} pixels. */
            TOO_LARGE
        }

        private final Kind kind;

        WatermarkException(Kind kind, String message, Throwable cause) {
            super(message, cause);
            this.kind = kind;
        }

        public Kind kind() {
            return kind;
        }
    }

    /**
     * The file, marked with {@code text}, as a JPEG: {@link #watermark(byte[], String, String)} on
     * the file as {@link #read(Blob)} reads it, with the same text for a small picture.
     *
     * @throws WatermarkException when it cannot be, and so must not be served
     */
    public byte[] watermark(Blob blob, String text) throws WatermarkException {
        return watermark(read(blob), text, text);
    }

    /**
     * The file's bytes, marked with {@code text}, or with {@code shortText} on a picture too small
     * for {@code text} to fit across, as a JPEG.
     *
     * @throws WatermarkException when it cannot be, and so must not be served
     */
    public byte[] watermark(byte[] bytes, String text, String shortText) throws WatermarkException {
        return watermark(bytes, text, shortText, Placement.TILED);
    }

    /**
     * Since 0.5.0, for a rights policy's watermark: the file's bytes, marked with {@code text} at
     * {@code placement}, as a JPEG, held to the same limits. Tiled, the text is the short one too.
     *
     * @throws WatermarkException when it cannot be, and so must not be served
     */
    public byte[] watermark(byte[] bytes, String text, Placement placement) throws WatermarkException {
        return watermark(bytes, text, text, placement);
    }

    private byte[] watermark(byte[] bytes, String text, String shortText, Placement placement)
            throws WatermarkException {
        try (ImageInputStream input = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) {
                throw refused(WatermarkException.Kind.NOT_AN_IMAGE, "not a picture ImageIO reads", null);
            }
            ImageReader reader = readers.next();
            try {
                String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                if (!FORMATS.contains(format)) {
                    throw refused(WatermarkException.Kind.NOT_AN_IMAGE, "a " + format + " file, not a JPEG or a PNG",
                            null);
                }
                reader.setInput(input, true, true);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width <= 0 || height <= 0 || width > MAX_SIDE || height > MAX_SIDE
                        || (long) width * height > MAX_PIXELS) {
                    throw refused(WatermarkException.Kind.TOO_LARGE, width + " by " + height + " pixels", null);
                }
                long decoded = decodedBytes(width, height, bytesPerPixel(reader), bytes.length);
                if (decoded > MAX_DECODED_BYTES) {
                    throw refused(WatermarkException.Kind.TOO_LARGE,
                            width + " by " + height + " pixels would take " + decoded + " bytes to mark", null);
                }
                if (placement != Placement.TILED) {
                    return jpeg(markOnce(reader.read(0), once(width, height, text, placement)));
                }
                Layout layout = layout(width, height, text, shortText);
                if (layout.tiles() > MAX_TILES) {
                    throw refused(WatermarkException.Kind.TOO_LARGE,
                            width + " by " + height + " pixels would take " + layout.tiles() + " tiles", null);
                }
                return jpeg(mark(reader.read(0), layout));
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException e) {
            throw refused(WatermarkException.Kind.NOT_AN_IMAGE, "the picture could not be decoded or marked", e);
        }
    }

    /**
     * What marking a picture holds in memory, as this class counts it: the decoded picture, the
     * marked copy at 4 bytes a pixel, and the file twice, as read and as the stream it is decoded
     * from. The JVM's own peak is higher: the JPEG written and what the decoder keeps besides.
     */
    static long decodedBytes(int width, int height, int bytesPerPixel, int fileBytes) {
        return (long) width * height * (bytesPerPixel + 4) + 2L * fileBytes;
    }

    /**
     * What one pixel takes decoded, read from the picture's header: the larger of its own type's
     * and the type {@code read(0)} decodes it into, the first of {@code getImageTypes(0)}, which can
     * be wider, as a 16-bit picture with a transparent colour is; each its samples' bits, rounded up
     * to bytes. {@link #UNKNOWN_BYTES_PER_PIXEL} when neither says.
     */
    static int bytesPerPixel(ImageReader reader) throws IOException {
        int raw = bytesOf(reader.getRawImageType(0));
        Iterator<ImageTypeSpecifier> types = reader.getImageTypes(0);
        int decoded = bytesOf(types != null && types.hasNext() ? types.next() : null);
        int most = Math.max(raw, decoded);
        return most <= 0 ? UNKNOWN_BYTES_PER_PIXEL : most;
    }

    private static int bytesOf(ImageTypeSpecifier type) {
        if (type == null) {
            return 0;
        }
        int bits = 0;
        for (int size : type.getSampleModel().getSampleSize()) {
            bits += size;
        }
        return (bits + 7) / 8;
    }

    /**
     * The file's bytes, at most {@link #MAX_BYTES}, whatever length the blob claims.
     *
     * @throws WatermarkException {@code TOO_LARGE} over the limit, {@code NOT_AN_IMAGE} when it
     *             cannot be read
     */
    public byte[] read(Blob blob) throws WatermarkException {
        try (InputStream in = blob.getStream()) {
            byte[] bytes = in.readNBytes((int) MAX_BYTES + 1);
            if (bytes.length > MAX_BYTES) {
                throw refused(WatermarkException.Kind.TOO_LARGE, "more than " + MAX_BYTES + " bytes", null);
            }
            return bytes;
        } catch (IOException | RuntimeException e) {
            throw refused(WatermarkException.Kind.NOT_AN_IMAGE, "the file could not be read", e);
        }
    }

    /**
     * How the text is laid on a picture.
     *
     * @param text what is drawn: the full text, or the short one when the full one is longer than the
     *            picture's diagonal
     * @param size the font's size, from the picture's shorter side, smaller where the text would not
     *            fit along the diagonal
     * @param tiles how many times it is drawn
     */
    record Layout(String text, int size, int stepX, int stepY, int reach, long tiles) {
    }

    static Layout layout(int width, int height, String text, String shortText) {
        int reach = (int) Math.ceil(Math.hypot(width, height));
        int size = Math.max(12, Math.min(160, Math.min(width, height) / 12));
        FontMetrics metrics = metrics(size);
        String chosen = text;
        if (metrics.stringWidth(chosen) > reach * 0.9) {
            // Too long for the diagonal: a smaller font, down to 12, then the short text.
            size = Math.max(12, Math.min(size - 1, (int) (size * reach * 0.9 / metrics.stringWidth(chosen))));
            metrics = metrics(size);
            while (metrics.stringWidth(chosen) > reach * 0.9 && size > 12) {
                metrics = metrics(--size);
            }
            if (metrics.stringWidth(chosen) > reach * 0.9) {
                chosen = shortText;
            }
        }
        // On a picture too small even for the short text at 12, a smaller font, so that a copy still
        // carries it whole, down to 7.
        while (metrics.stringWidth(chosen) > reach * 0.9 && size > 7) {
            metrics = metrics(--size);
        }
        int stepX = metrics.stringWidth(chosen) + size * 2;
        int stepY = metrics.getHeight() * 3;
        long rows = (reach + 2L * stepY) / stepY + 1;
        long columns = (reach + 2L * stepX) / stepX + 1;
        return new Layout(chosen, size, stepX, stepY, reach, rows * columns);
    }

    private static FontMetrics metrics(int size) {
        Graphics2D g = new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB).createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            return g.getFontMetrics(font(size));
        } finally {
            g.dispose();
        }
    }

    private static Font font(int size) {
        return new Font(Font.SANS_SERIF, Font.BOLD, size);
    }

    /** A new picture: the source's pixels on white, and the text tiled across it at -30 degrees. */
    static BufferedImage mark(BufferedImage source, Layout layout) {
        int width = source.getWidth();
        int height = source.getHeight();
        BufferedImage canvas = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = canvas.createGraphics();
        try {
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, width, height);
            g.drawImage(source, 0, 0, null);
            source.flush();
        } finally {
            g.dispose();
        }
        draw(canvas, layout);
        return canvas;
    }

    /** The text tiled across {@code canvas} at -30 degrees, light over dark. */
    private static void draw(BufferedImage canvas, Layout layout) {
        int width = canvas.getWidth();
        int height = canvas.getHeight();
        Graphics2D g = canvas.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setFont(font(layout.size()));
            String text = layout.text();
            int stepX = layout.stepX();
            int stepY = layout.stepY();
            int reach = layout.reach();
            // Rotated about the centre, the tiles must cover the picture's diagonal both ways.
            g.rotate(Math.toRadians(-30), width / 2.0, height / 2.0);
            int top = (height - reach) / 2 - stepY;
            int left = (width - reach) / 2 - stepX;
            AlphaComposite shadow = AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.45f);
            AlphaComposite light = AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.6f);
            int offset = Math.max(1, layout.size() / 16);
            for (int row = 0, y = top; y < top + reach + 2 * stepY; row++, y += stepY) {
                for (int x = left + (row % 2) * stepX / 2; x < left + reach + 2 * stepX; x += stepX) {
                    g.setComposite(shadow);
                    g.setColor(Color.BLACK);
                    g.drawString(text, x + offset, y + offset);
                    g.setComposite(light);
                    g.setColor(Color.WHITE);
                    g.drawString(text, x, y);
                }
            }
        } finally {
            g.dispose();
        }
    }

    /**
     * Since 0.5.0, for a video: the mark alone, {@code text} at {@code placement} on a transparent
     * picture of {@code width} by {@code height}, as a PNG, which the platform's video tools draw over
     * every frame. Held to the same sides, pixels and tiles as a picture.
     *
     * @throws WatermarkException when it cannot be made
     */
    public byte[] overlay(int width, int height, String text, Placement placement) throws WatermarkException {
        if (width <= 0 || height <= 0 || width > MAX_SIDE || height > MAX_SIDE || (long) width * height > MAX_PIXELS) {
            throw refused(WatermarkException.Kind.TOO_LARGE, width + " by " + height + " pixels", null);
        }
        try {
            BufferedImage canvas = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
            if (placement == Placement.TILED) {
                Layout layout = layout(width, height, text, text);
                if (layout.tiles() > MAX_TILES) {
                    throw refused(WatermarkException.Kind.TOO_LARGE,
                            width + " by " + height + " pixels would take " + layout.tiles() + " tiles", null);
                }
                draw(canvas, layout);
            } else {
                drawOnce(canvas, once(width, height, text, placement));
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (!ImageIO.write(canvas, "png", out)) {
                throw refused(WatermarkException.Kind.NOT_AN_IMAGE, "no PNG writer", null);
            }
            return out.toByteArray();
        } catch (IOException | RuntimeException e) {
            throw refused(WatermarkException.Kind.NOT_AN_IMAGE, "the mark could not be drawn", e);
        }
    }

    /**
     * Where the text goes once: its font's size, from the picture's shorter side, smaller until it
     * fits nine tenths of the width, down to 7, and the baseline's start, a size's margin from the
     * edges it is placed by.
     */
    record Once(String text, int size, int x, int y) {
    }

    static Once once(int width, int height, String text, Placement placement) {
        int size = Math.max(12, Math.min(96, Math.min(width, height) / 14));
        FontMetrics metrics = metrics(size);
        while (metrics.stringWidth(text) > width * 0.9 && size > 7) {
            metrics = metrics(--size);
        }
        int textWidth = metrics.stringWidth(text);
        int margin = Math.max(4, size / 2);
        int left = margin;
        int right = Math.max(margin, width - textWidth - margin);
        int centreX = Math.max(0, (width - textWidth) / 2);
        int top = margin + metrics.getAscent();
        int bottom = Math.max(top, height - margin - metrics.getDescent());
        int middle = Math.max(metrics.getAscent(), (height + metrics.getAscent() - metrics.getDescent()) / 2);
        return switch (placement) {
        case CENTER -> new Once(text, size, centreX, middle);
        case TOP_LEFT -> new Once(text, size, left, top);
        case TOP_RIGHT -> new Once(text, size, right, top);
        case BOTTOM_LEFT -> new Once(text, size, left, bottom);
        case BOTTOM_RIGHT, TILED -> new Once(text, size, right, bottom);
        };
    }

    /** A new picture: the source's pixels on white, and the text once where {@code once} says. */
    static BufferedImage markOnce(BufferedImage source, Once once) {
        int width = source.getWidth();
        int height = source.getHeight();
        BufferedImage canvas = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = canvas.createGraphics();
        try {
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, width, height);
            g.drawImage(source, 0, 0, null);
            source.flush();
        } finally {
            g.dispose();
        }
        drawOnce(canvas, once);
        return canvas;
    }

    private static void drawOnce(BufferedImage canvas, Once once) {
        Graphics2D g = canvas.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setFont(font(once.size()));
            int offset = Math.max(1, once.size() / 16);
            g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.55f));
            g.setColor(Color.BLACK);
            g.drawString(once.text(), once.x() + offset, once.y() + offset);
            g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.8f));
            g.setColor(Color.WHITE);
            g.drawString(once.text(), once.x(), once.y());
        } finally {
            g.dispose();
        }
    }

    /** The picture as a JPEG, with no metadata but the JFIF header the writer starts every file with. */
    static byte[] jpeg(BufferedImage picture) throws IOException {
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ImageOutputStream output = new MemoryCacheImageOutputStream(out)) {
            writer.setOutput(output);
            ImageWriteParam parameters = writer.getDefaultWriteParam();
            parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            parameters.setCompressionQuality(QUALITY);
            writer.write(null, new IIOImage(picture, null, null), parameters);
        } finally {
            writer.dispose();
        }
        return out.toByteArray();
    }

    private static WatermarkException refused(WatermarkException.Kind kind, String message, Throwable cause) {
        return new WatermarkException(kind, message, cause);
    }
}
