package site.funshare.notes

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** /api/session parsing: new fields (features.qr, publicBaseUrl) and legacy servers. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SessionInfoTest {

    @Test
    fun parsesCurrentServerResponse() {
        val j = JSONObject("""
            {"needsSetup":false,"authenticated":true,
             "user":{"id":"u1","name":"ada","isAdmin":true,"createdAt":123},
             "registrationOpen":true,
             "features":{"trash":true,"history":true,"conflicts":true,"qr":true},
             "trashRetentionDays":30,
             "publicBaseUrl":"https://notes.example.com"}
        """)
        val s = SessionInfo.fromJson(j)
        assertTrue(s.authenticated)
        assertEquals("ada", s.user?.name)
        assertTrue(s.featuresQr)
        assertEquals("https://notes.example.com", s.publicBaseUrl)
    }

    @Test
    fun qrFeatureFalseWhenServerHasNoQrModule() {
        val s = SessionInfo.fromJson(JSONObject("""{"features":{"trash":true,"qr":false}}"""))
        assertFalse(s.featuresQr)
    }

    @Test
    fun legacyServerResponseKeepsDefaults() {
        // Servers before the share-head/QR update send neither field.
        val s = SessionInfo.fromJson(JSONObject("""{"needsSetup":true,"authenticated":false,"registrationOpen":false}"""))
        assertFalse(s.featuresQr)
        assertNull(s.publicBaseUrl)
    }

    @Test
    fun emptyPublicBaseUrlIsTreatedAsUnset() {
        val s = SessionInfo.fromJson(JSONObject("""{"publicBaseUrl":""}"""))
        assertNull(s.publicBaseUrl)
    }
}
