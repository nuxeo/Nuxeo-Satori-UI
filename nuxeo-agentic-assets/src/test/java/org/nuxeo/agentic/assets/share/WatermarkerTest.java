package org.nuxeo.agentic.assets.share;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Proxy;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.CRC32;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.share.Watermarker.WatermarkException;
import org.nuxeo.ecm.core.api.Blob;

/** The watermark: drawn across the whole picture, as a new JPEG with nothing of the file but its pixels. */
class WatermarkerTest {

    private static final String TEXT = "SHARED ab12cd34 UNTIL 2026-12-14 UTC";

    private final Watermarker watermarker = new Watermarker();

    private static BufferedImage decode(byte[] bytes) throws IOException {
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
        assertNotNull(image);
        return image;
    }

    private static String format(byte[] bytes) throws IOException {
        try (ImageInputStream input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            ImageReader reader = ImageIO.getImageReaders(input).next();
            return reader.getFormatName().toLowerCase();
        }
    }

    /** The share of pixels in a region whose colour moved by more than 24 on a channel. */
    private static double changed(BufferedImage before, BufferedImage after, int x0, int y0, int x1, int y1) {
        int changed = 0;
        int all = 0;
        for (int y = y0; y < y1; y++) {
            for (int x = x0; x < x1; x++) {
                int a = before.getRGB(x, y);
                int b = after.getRGB(x, y);
                all++;
                for (int shift = 0; shift <= 16; shift += 8) {
                    if (Math.abs((a >> shift & 0xff) - (b >> shift & 0xff)) > 24) {
                        changed++;
                        break;
                    }
                }
            }
        }
        return (double) changed / all;
    }

    @Test
    void thePictureIsMarkedAcrossAllOfItAndKeepsItsSize() throws Exception {
        byte[] file = ShareFakes.jpeg(800, 600, new Color(120, 120, 120));
        BufferedImage before = decode(file);

        byte[] marked = watermarker.watermark(ShareFakes.blob(file, "image/jpeg"), TEXT);

        assertEquals("jpeg", format(marked));
        BufferedImage after = decode(marked);
        assertEquals(800, after.getWidth());
        assertEquals(600, after.getHeight());
        assertTrue(changed(before, after, 0, 0, 800, 600) > 0.05, "the mark covers a good part of the picture");
        // Each quarter is marked: cropping one out still leaves a mark.
        for (int[] quarter : new int[][] { { 0, 0 }, { 400, 0 }, { 0, 300 }, { 400, 300 } }) {
            assertTrue(changed(before, after, quarter[0], quarter[1], quarter[0] + 400, quarter[1] + 300) > 0.02,
                    () -> Arrays.toString(quarter));
        }
        // Both lighter and darker, so that it shows on any picture.
        boolean lighter = false;
        boolean darker = false;
        for (int y = 0; y < 600; y += 3) {
            for (int x = 0; x < 800; x += 3) {
                int value = after.getRGB(x, y) & 0xff;
                lighter |= value > 200;
                darker |= value < 70;
            }
        }
        assertTrue(lighter && darker);
    }

    @Test
    void aSmallPictureIsMarkedToo() throws Exception {
        byte[] file = ShareFakes.jpeg(60, 40, new Color(120, 120, 120));
        BufferedImage after = decode(watermarker.watermark(ShareFakes.blob(file, "image/jpeg"), TEXT));
        assertTrue(changed(decode(file), after, 0, 0, 60, 40) > 0.05);
    }

    @Test
    void aPngWithTransparencyBecomesAJpegOnWhite() throws Exception {
        byte[] file = ShareFakes.png(300, 200, new Color(10, 120, 10));
        byte[] marked = watermarker.watermark(ShareFakes.blob(file, "image/png"), TEXT);
        assertEquals("jpeg", format(marked));
        assertFalse(decode(marked).getColorModel().hasAlpha());
    }

    /** A comment segment, as a camera's or an editor's metadata would be, does not come through. */
    @Test
    void nothingOfTheFileButItsPixelsComesThrough() throws Exception {
        byte[] jpeg = ShareFakes.jpeg(200, 150, Color.ORANGE);
        byte[] note = "SECRET-METADATA: the photographer's home address".getBytes(StandardCharsets.US_ASCII);
        ByteBuffer withComment = ByteBuffer.allocate(jpeg.length + 4 + note.length);
        withComment.put(jpeg, 0, 2); // SOI
        withComment.put((byte) 0xFF).put((byte) 0xFE).putShort((short) (note.length + 2)).put(note); // COM
        withComment.put(jpeg, 2, jpeg.length - 2);
        byte[] file = withComment.array();
        assertNotNull(ImageIO.read(new ByteArrayInputStream(file)), "the file with its comment is a picture");
        assertTrue(new String(file, StandardCharsets.ISO_8859_1).contains("SECRET-METADATA"));

        byte[] marked = watermarker.watermark(ShareFakes.blob(file, "image/jpeg"), TEXT);

        assertFalse(new String(marked, StandardCharsets.ISO_8859_1).contains("SECRET-METADATA"));
    }

    @Test
    void aFileThatIsNotAJpegOrAPngIsRefused() {
        for (byte[] file : new byte[][] { "not a picture".getBytes(StandardCharsets.US_ASCII), new byte[0],
                ShareFakes.picture(20, 20, Color.RED, "gif", BufferedImage.TYPE_INT_RGB),
                ShareFakes.picture(20, 20, Color.RED, "bmp", BufferedImage.TYPE_INT_RGB),
                Arrays.copyOf(ShareFakes.jpeg(200, 150, Color.RED), 300) }) {
            WatermarkException e = assertThrows(WatermarkException.class,
                    () -> watermarker.watermark(ShareFakes.blob(file, "image/jpeg"), TEXT));
            assertEquals(WatermarkException.Kind.NOT_AN_IMAGE, e.kind());
        }
    }

    /** A small file whose header claims a huge picture is refused from its header, before its pixels. */
    @Test
    void aPictureOfTooManyPixelsIsRefusedFromItsHeader() throws Exception {
        byte[] png = ShareFakes.png(1, 1, Color.RED);
        claimSize(png, 10_000, 10_000);
        // The header is one ImageIO reads, and claims 100 million pixels.
        assertEquals(10_000, widthOf(png));

        WatermarkException e = assertThrows(WatermarkException.class,
                () -> watermarker.watermark(ShareFakes.blob(png, "image/png"), TEXT));
        assertEquals(WatermarkException.Kind.TOO_LARGE, e.kind());

        // The limit itself is marked: 24 million pixels claimed by a 6000 by 4000 header passes the
        // size check, and fails only because the pixels are not there.
        byte[] atLimit = ShareFakes.png(1, 1, Color.RED);
        claimSize(atLimit, 6000, 4000);
        WatermarkException limit = assertThrows(WatermarkException.class,
                () -> watermarker.watermark(ShareFakes.blob(atLimit, "image/png"), TEXT));
        assertEquals(WatermarkException.Kind.NOT_AN_IMAGE, limit.kind());
        byte[] overLimit = ShareFakes.png(1, 1, Color.RED);
        claimSize(overLimit, 6001, 4000);
        assertEquals(WatermarkException.Kind.TOO_LARGE, assertThrows(WatermarkException.class,
                () -> watermarker.watermark(ShareFakes.blob(overLimit, "image/png"), TEXT)).kind());
    }

    /**
     * Within the pixels, a picture of 16 bits a channel would take 288 MB to mark: refused from its
     * header. Of 8, 192 MB: let through to be decoded.
     */
    @Test
    void aPictureTooDeepToMarkInItsBudgetIsRefusedFromItsHeader() throws Exception {
        byte[] deep = ShareFakes.png(1, 1, Color.RED);
        claimSize(deep, 6000, 4000);
        assertEquals(6, deep[25], "an RGBA picture");
        deep[24] = 16;
        fixHeaderChecksum(deep);
        assertEquals(WatermarkException.Kind.TOO_LARGE, assertThrows(WatermarkException.class,
                () -> watermarker.watermark(ShareFakes.blob(deep, "image/png"), TEXT)).kind());

        byte[] shallow = ShareFakes.png(1, 1, Color.RED);
        claimSize(shallow, 6000, 4000);
        assertEquals(WatermarkException.Kind.NOT_AN_IMAGE, assertThrows(WatermarkException.class,
                () -> watermarker.watermark(ShareFakes.blob(shallow, "image/png"), TEXT)).kind());
    }

    private static void fixHeaderChecksum(byte[] png) {
        CRC32 crc = new CRC32();
        crc.update(png, 12, 17);
        ByteBuffer.wrap(png).putInt(29, (int) crc.getValue());
    }

    @Test
    void aFileOfMoreThan64MebibytesIsRefusedWithoutReadingItAll() {
        long[] read = new long[1];
        InputStream endless = new InputStream() {
            @Override
            public int read() {
                read[0]++;
                return 0;
            }

            @Override
            public int read(byte[] buffer, int offset, int length) {
                read[0] += length;
                Arrays.fill(buffer, offset, offset + length, (byte) 0);
                return length;
            }
        };
        Blob huge = (Blob) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] { Blob.class },
                (proxy, method, args) -> switch (method.getName()) {
                case "getStream" -> endless;
                case "getLength" -> -1L;
                default -> throw new UnsupportedOperationException(method.getName());
                });
        WatermarkException e = assertThrows(WatermarkException.class, () -> watermarker.watermark(huge, TEXT));
        assertEquals(WatermarkException.Kind.TOO_LARGE, e.kind());
        assertTrue(read[0] <= Watermarker.MAX_BYTES + 1, () -> read[0] + " bytes read");
    }

    private static int widthOf(byte[] png) throws IOException {
        try (ImageInputStream input = ImageIO.createImageInputStream(new ByteArrayInputStream(png))) {
            ImageReader reader = ImageIO.getImageReaders(input).next();
            reader.setInput(input);
            return reader.getWidth(0);
        }
    }

    /** Write another width and height into a PNG's header, with the header's checksum to match. */
    private static void claimSize(byte[] png, int width, int height) {
        // Signature (8), then IHDR: length (4), type (4) at 12, width at 16, height at 20, ..., CRC at 29.
        ByteBuffer buffer = ByteBuffer.wrap(png);
        assertEquals("IHDR", new String(png, 12, 4, StandardCharsets.US_ASCII));
        buffer.putInt(16, width);
        buffer.putInt(20, height);
        CRC32 crc = new CRC32();
        crc.update(png, 12, 17);
        buffer.putInt(29, (int) crc.getValue());
    }
}
