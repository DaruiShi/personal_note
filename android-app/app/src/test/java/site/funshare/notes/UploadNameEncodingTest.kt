package site.funshare.notes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URLDecoder

/**
 * The original file name rides in the X-File-Name request header, and HTTP
 * header values may only hold ISO-8859-1 — a raw Chinese file name makes OkHttp
 * reject the request before it is sent. [encodeUploadName] percent-encodes the
 * name (the web client uses encodeURIComponent), and the server decodes it back
 * with decodeURIComponent().
 */
class UploadNameEncodingTest {

    @Test
    fun chineseFileNameBecomesHeaderSafeAscii() {
        val name = "中文报告 2026（终稿）.docx"
        val encoded = encodeUploadName(name)
        assertTrue("header value must be ASCII: $encoded", encoded.all { it.code < 128 })
        assertEquals(name, decodeLikeTheServer(encoded))
    }

    @Test
    fun asciiNamesSurviveUnchanged() {
        assertEquals("plain-name.docx", encodeUploadName("plain-name.docx"))
    }

    @Test
    fun spacesAndPlusesRoundTrip() {
        assertEquals("a b+c .docx", decodeLikeTheServer(encodeUploadName("a b+c .docx")))
    }

    /** What the server does: decodeURIComponent(). JVM's URLDecoder is its
     *  form-urlencoded twin — with "+" mapped to %20 the two agree. */
    private fun decodeLikeTheServer(encoded: String): String =
        URLDecoder.decode(encoded, "UTF-8")
}
