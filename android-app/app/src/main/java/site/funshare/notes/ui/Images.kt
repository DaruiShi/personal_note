package site.funshare.notes.ui

import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.view.View
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/** A compressed image ready for POST /api/uploads. */
data class PreparedImage(
    val bytes: ByteArray,
    val mime: String,
    /** Full display name including extension ("scan.pdf"). */
    val name: String,
    /** Sanitized base name for the markdown alt text. */
    val alt: String,
)

/** Client-side guard matching the server's UPLOAD_LIMIT. */
const val MAX_UPLOAD_BYTES = 25 * 1024 * 1024

private const val MAX_SIDE = 2048
private const val PASSTHROUGH_LIMIT = 2 * 1024 * 1024 // keep small GIF/WebP byte-identical

/**
 * Read the picked/copied image, shrink large photos (longest side ≤ 2048px)
 * and compress to JPEG. Small GIF/WebP files are passed through unchanged so
 * animation is preserved. Returns null when nothing usable could be decoded.
 */
suspend fun prepareImageForUpload(context: Context, uri: Uri): PreparedImage? =
    withContext(Dispatchers.IO) {
        try {
            val resolver = context.contentResolver
            val mime = resolver.getType(uri) ?: ""
            val name = displayName(resolver, uri)

            if (mime == "image/gif" || mime == "image/webp") {
                val raw = resolver.openInputStream(uri)?.use { it.readBytes() }
                if (raw != null && raw.size in 1..PASSTHROUGH_LIMIT) {
                    return@withContext PreparedImage(raw, mime, name, altFrom(name))
                }
            }

            val bitmap = decodeScaled(resolver, uri, MAX_SIDE) ?: return@withContext null
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 82, out)
            bitmap.recycle()
            val bytes = out.toByteArray()
            if (bytes.isEmpty() || bytes.size > 5 * 1024 * 1024) null
            else PreparedImage(bytes, "image/jpeg", name, altFrom(name))
        } catch (e: Exception) {
            null
        }
    }

/** Read a document as raw bytes (no recompression). Null when unreadable. */
suspend fun readDocumentForUpload(context: Context, uri: Uri): Pair<ByteArray, String>? =
    withContext(Dispatchers.IO) {
        try {
            val resolver = context.contentResolver
            val raw = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return@withContext null
            val name = displayName(resolver, uri)
            if (raw.isEmpty() || raw.size > MAX_UPLOAD_BYTES) null else raw to name
        } catch (e: Exception) {
            null
        }
    }

private fun altFrom(name: String): String =
    name.substringBeforeLast('.')
        .replace("[", " ").replace("]", " ").trim()
        .take(100)
        .ifEmpty { "image" }

private fun displayName(resolver: ContentResolver, uri: Uri): String = try {
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
            val name = c.getString(0)?.trim().orEmpty()
            return name.take(120).ifEmpty { "file" }
        }
    }
    "file"
} catch (e: Exception) {
    "file"
}

private fun decodeScaled(resolver: ContentResolver, uri: Uri, maxSide: Int): Bitmap? {
    if (Build.VERSION.SDK_INT >= 28) {
        val source = ImageDecoder.createSource(resolver, uri)
        return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            val w = info.size.width
            val h = info.size.height
            if (w > 0 && h > 0) {
                val scale = maxSide.toFloat() / max(w, h)
                if (scale < 1f) {
                    decoder.setTargetSize((w * scale).roundToInt(), (h * scale).roundToInt())
                }
            }
        }
    }
    // API 26/27: BitmapFactory + inSampleSize + manual EXIF rotation
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val decoded = resolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, opts)
    } ?: return null
    val upright = applyExifRotation(resolver, uri, decoded) ?: return null
    val longest = max(upright.width, upright.height)
    return if (longest > maxSide) {
        val s = maxSide.toFloat() / longest
        Bitmap.createScaledBitmap(upright, (upright.width * s).roundToInt(), (upright.height * s).roundToInt(), true)
    } else {
        upright
    }
}

private fun applyExifRotation(resolver: ContentResolver, uri: Uri, bitmap: Bitmap): Bitmap? = try {
    val orientation = resolver.openInputStream(uri)?.use { input ->
        ExifInterface(input).getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL,
        )
    } ?: ExifInterface.ORIENTATION_NORMAL
    val degrees = when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
    if (degrees == 0f) {
        bitmap
    } else {
        val matrix = android.graphics.Matrix().apply { postRotate(degrees) }
        Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
} catch (e: Exception) {
    bitmap
}

/**
 * Resolve server-relative /uploads/ URLs for the rendered preview only —
 * stored note content is never modified. Document links materialize under
 * the public domain ([publicBase]) so the address users see and copy is
 * "https://funshare.site/…"; images keep loading through the direct server
 * address ([serverBase]) the phone is signed in to.
 */
fun resolvePreviewUrls(markdown: String, publicBase: String, serverBase: String): String {
    if (markdown.isEmpty()) return markdown
    var out = markdown
    if (serverBase.isNotEmpty()) {
        // images first: "!…](/uploads/" → direct server address
        out = out.replace(Regex("""(!\[[^\]]*\])\(/uploads/""")) { m ->
            m.groupValues[1] + "(" + serverBase + "/uploads/"
        }
    }
    if (publicBase.isNotEmpty()) {
        // whatever still points at a bare /uploads/ is a document link → public domain
        out = out.replace("](/uploads/", "]($publicBase/uploads/")
    }
    return out
}

/* ------------------------------------------- opening links / attachments */

/** Content type for a file name, used when handing it to a viewer app. */
fun mimeForFileName(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
    "pdf" -> "application/pdf"
    "doc" -> "application/msword"
    "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    "ppt" -> "application/vnd.ms-powerpoint"
    "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    "xls" -> "application/vnd.ms-excel"
    "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    "odt" -> "application/vnd.oasis.opendocument.text"
    "odp" -> "application/vnd.oasis.opendocument.presentation"
    "ods" -> "application/vnd.oasis.opendocument.spreadsheet"
    "txt", "md" -> "text/plain"
    "csv" -> "text/csv"
    "zip" -> "application/zip"
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "gif" -> "image/gif"
    "webp" -> "image/webp"
    else -> "application/octet-stream"
}

/**
 * Resolve a markdown link tapped in the preview. Server uploads (relative,
 * public-domain or direct-server forms) are downloaded through the app's
 * authenticated client — via [serverBase], the address the session belongs
 * to — and handed to a viewer; everything else opens as a normal intent.
 */
fun openPreviewLink(
    view: View,
    link: String,
    client: OkHttpClient,
    serverBase: String,
    publicBase: String,
) {
    val context = view.context
    fun external(url: String) {
        try {
            context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            Toast.makeText(context, "No app can open this link", Toast.LENGTH_SHORT).show()
        }
    }
    val path = when {
        link.startsWith("/") -> link
        serverBase.isNotEmpty() && link.startsWith(serverBase) -> link.substring(serverBase.length)
        publicBase.isNotEmpty() && link.startsWith(publicBase) -> link.substring(publicBase.length)
        else -> null
    }
    if (path == null || !path.startsWith("/uploads/")) {
        return external(link)
    }
    if (serverBase.isEmpty()) return external(link)
    val url = serverBase + path
    val name = path.substringAfterLast('/').ifEmpty { "file" }
    Thread {
        try {
            val resp = client.newCall(Request.Builder().url(url).build()).execute()
            resp.use { r ->
                if (!r.isSuccessful) throw Exception("HTTP ${r.code}")
                val bytes = r.body?.bytes() ?: throw Exception("Empty response")
                val dir = File(context.cacheDir, "downloads").apply { mkdirs() }
                val file = File(dir, name)
                file.writeBytes(bytes)
                val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
                val intent = android.content.Intent(android.content.Intent.ACTION_VIEW)
                    .setDataAndType(uri, mimeForFileName(name))
                    .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                context.startActivity(intent)
            }
        } catch (e: Exception) {
            (context as? android.app.Activity)?.runOnUiThread {
                Toast.makeText(context, "Couldn't open $name — ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }.start()
}
