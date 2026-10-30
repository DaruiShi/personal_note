package site.funshare.notes

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint

/**
 * Renders the QR SVG served by /share/<token>/qr.svg into a Bitmap.
 *
 * The server emits one `<rect x y width height/>` per dark module inside a
 * `<g fill="#111111">`, on a white background rect, with a 4-module quiet
 * zone already baked into the coordinates — so parsing is just rect
 * extraction and uniform scaling. No SVG library involved (the project keeps
 * its dependency list at zero beyond Compose/OkHttp).
 */
object QrSvg {

    private const val RECT_PATTERN = """<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/>"""
    private val RECT = Regex(RECT_PATTERN)
    private val VIEWBOX = Regex("""viewBox="0 0 (\d+) (\d+)"""")

    /** One dark module in viewBox units: [x, y, w, h]. */
    data class Module(val x: Int, val y: Int, val w: Int, val h: Int)

    /** The square viewBox side, or null when the SVG does not parse. */
    fun viewBoxDim(svg: String): Int? {
        val m = VIEWBOX.find(svg) ?: return null
        val w = m.groupValues[1].toIntOrNull() ?: return null
        val h = m.groupValues[2].toIntOrNull() ?: return null
        return if (w == h && w > 0) w else null
    }

    /**
     * Dark modules of the symbol. Null when anything looks off (no rects,
     * or a rect outside the viewBox) — callers treat that as "no QR".
     */
    fun modules(svg: String): List<Module>? {
        val dim = viewBoxDim(svg) ?: return null
        val out = mutableListOf<Module>()
        for (m in RECT.findAll(svg)) {
            val x = m.groupValues[1].toIntOrNull() ?: return null
            val y = m.groupValues[2].toIntOrNull() ?: return null
            val w = m.groupValues[3].toIntOrNull() ?: return null
            val h = m.groupValues[4].toIntOrNull() ?: return null
            if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > dim || y + h > dim) return null
            out.add(Module(x, y, w, h))
        }
        return if (out.isEmpty()) null else out
    }

    /**
     * Render to a square ARGB bitmap of [sizePx] × [sizePx]: white
     * background, near-black modules, no anti-aliasing between modules
     * (scale is uniform so edges land on exact pixel multiples when
     * sizePx is a multiple of the viewBox side).
     */
    fun render(svg: String, sizePx: Int): Bitmap? {
        val dim = viewBoxDim(svg) ?: return null
        val mods = modules(svg) ?: return null
        val bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)
        val paint = Paint().apply {
            color = Color.rgb(0x11, 0x11, 0x11)
            isAntiAlias = false
            style = Paint.Style.FILL
        }
        val s = sizePx.toFloat() / dim
        for (m in mods) {
            canvas.drawRect(m.x * s, m.y * s, (m.x + m.w) * s, (m.y + m.h) * s, paint)
        }
        return bmp
    }
}
