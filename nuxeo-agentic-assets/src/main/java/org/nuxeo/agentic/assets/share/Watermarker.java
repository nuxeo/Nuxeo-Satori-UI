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
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;

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
 * <li>a file of more than {@value #MAX_BYTES} bytes, or a picture of more than
 * {@value #MAX_PIXELS} pixels, read from its header before its pixels are, so that a small file
 * claiming a huge picture is refused before it takes memory;</li>
 * <li>a file ImageIO cannot decode, such as a CMYK JPEG, or text it cannot draw.</li>
 * </ul>
 * The file is read into memory and decoded from there, so the picture is never written to a
 * temporary file unmarked.
 */
public class Watermarker {

    /** 64 MiB. */
    public static final long MAX_BYTES = 64L * 1024 * 1024;

    /** A 6000 by 4000 picture: about 170 MB while it is marked. */
    public static final long MAX_PIXELS = 24_000_000L;

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
     * The file, marked with {@code text}, as a JPEG.
     *
     * @throws WatermarkException when it cannot be, and so must not be served
     */
    public byte[] watermark(Blob blob, String text) throws WatermarkException {
        byte[] bytes = read(blob);
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
                if (width <= 0 || height <= 0 || (long) width * height > MAX_PIXELS) {
                    throw refused(WatermarkException.Kind.TOO_LARGE, width + " by " + height + " pixels", null);
                }
                BufferedImage marked = mark(reader.read(0), text);
                return jpeg(marked);
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException e) {
            throw refused(WatermarkException.Kind.NOT_AN_IMAGE, "the picture could not be decoded or marked", e);
        }
    }

    /** At most {@link #MAX_BYTES}, whatever length the blob claims. */
    private static byte[] read(Blob blob) throws WatermarkException {
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

    /** A new picture: the source's pixels on white, and the text tiled across it at -30 degrees. */
    static BufferedImage mark(BufferedImage source, String text) {
        int width = source.getWidth();
        int height = source.getHeight();
        BufferedImage canvas = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = canvas.createGraphics();
        try {
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, width, height);
            g.drawImage(source, 0, 0, null);
            source.flush();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            int size = Math.max(12, Math.min(160, Math.min(width, height) / 12));
            g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, size));
            FontMetrics metrics = g.getFontMetrics();
            int stepX = metrics.stringWidth(text) + size * 2;
            int stepY = metrics.getHeight() * 3;
            // Rotated about the centre, the tiles must cover the picture's diagonal both ways.
            g.rotate(Math.toRadians(-30), width / 2.0, height / 2.0);
            int reach = (int) Math.ceil(Math.hypot(width, height));
            int top = (height - reach) / 2 - stepY;
            int left = (width - reach) / 2 - stepX;
            AlphaComposite shadow = AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.45f);
            AlphaComposite light = AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.6f);
            int offset = Math.max(1, size / 16);
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
        return canvas;
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
