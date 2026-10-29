package site.funshare.notes.ui

import android.graphics.drawable.Drawable
import android.net.Uri
import android.util.Base64
import io.noties.markwon.image.ImageItem
import io.noties.markwon.image.SchemeHandler
import org.scilab.forge.jlatexmath.TeXFormula
import ru.noties.jlatexmath.JLatexMathDrawable

/**
 * LaTeX math support for the preview.
 *
 * Markwon/commonmark know nothing about equations, so before parsing, math
 * regions are replaced with ordinary images using a private `latex://`
 * scheme; a [LatexImageHandler] registered with the ImagesPlugin renders the
 * payload with JLatexMath into a Drawable.
 *
 * Recognized forms: display `$$…$$` and `\[…\]`, inline `\[…\]`'s cousin
 * `\(…\)`, and single-line `$…$`. Regions inside fenced code blocks are left
 * untouched, equations that fail to parse are left as plain text, and stored
 * note content is never modified — this only affects the rendered preview.
 */

private val FENCE_LINE = Regex("""^\s*(```|~~~)""")

/** Ordered most-specific first: `$$…$$` (may span lines), then `\[…\]`, then `\(…\)`. */
private val BLOCK_PATTERNS = listOf(
    Regex("""\$\$([\s\S]+?)\$\$""") to true,
    Regex("""\\\[([\s\S]+?)\\\]""") to true,
    Regex("""\\\(([\s\S]+?)\\\)""") to false,
)

/** Single-line `$…$`: content without `$` or newlines, no space at the edges. */
private val INLINE_PATTERN = Regex("""\$([^\n$]+?)\$""")

private fun latexParses(latex: String): Boolean = try {
    TeXFormula(latex)
    true
} catch (e: Exception) {
    false
}

private fun encodeLatex(latex: String, display: Boolean): String {
    val payload = Base64.encodeToString(
        latex.toByteArray(Charsets.UTF_8),
        Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
    )
    return "![math](latex://$payload?s=${if (display) "1" else "0"})"
}

/** Masked [start, end) ranges of fenced code blocks, in source offsets. */
private fun fencedRanges(markdown: String): List<IntRange> {
    val ranges = mutableListOf<IntRange>()
    var inFence = false
    var idx = 0
    for (line in markdown.lines()) {
        val start = idx
        val end = idx + line.length
        if (FENCE_LINE.containsMatchIn(line)) {
            ranges += start..end
            inFence = !inFence
        } else if (inFence) {
            ranges += start..end
        }
        idx = end + 1
    }
    return ranges
}

fun preprocessLatex(markdown: String): String {
    if (!markdown.contains('\\') && !markdown.contains('$')) return markdown
    val fences = fencedRanges(markdown)
    fun masked(pos: Int) = fences.any { pos in it }

    data class Hit(val range: IntRange, val latex: String, val display: Boolean)
    val hits = mutableListOf<Hit>()

    for ((pattern, display) in BLOCK_PATTERNS) {
        for (m in pattern.findAll(markdown)) {
            if (masked(m.range.first)) continue
            val body = m.groupValues[1]
            if (body.isBlank() || body.contains('`')) continue
            if (latexParses(body)) hits += Hit(m.range, body, display)
        }
    }
    for (m in INLINE_PATTERN.findAll(markdown)) {
        if (masked(m.range.first)) continue
        val body = m.groupValues[1]
        if (body.isBlank() || body.contains('`')) continue
        if (body.startsWith(' ') || body.endsWith(' ')) continue
        // "$100, $200" — a price list, not math: closing $ followed by a digit
        val after = m.range.last + 1
        if (after < markdown.length && markdown[after].isDigit()) continue
        if (latexParses(body)) hits += Hit(m.range, body, false)
    }

    if (hits.isEmpty()) return markdown
    var out = markdown
    for (hit in hits.sortedByDescending { it.range.first }) {
        out = out.substring(0, hit.range.first) +
            encodeLatex(hit.latex, hit.display) +
            out.substring(hit.range.last + 1)
    }
    return out
}

/**
 * Renders `latex://<base64url>?s=[01]` destinations with JLatexMath.
 * [textSizePx] is the body text size in pixels (already density- and
 * font-scale-aware) so equations match the surrounding preview text;
 * [color] tints the glyphs to the current theme.
 */
class LatexImageHandler(
    private val textSizePx: Float,
    private val color: Int,
) : SchemeHandler() {

    override fun handle(href: String, uri: Uri): ImageItem {
        val drawable: Drawable = try {
            val payload = uri.host ?: href.removePrefix("latex://")
            val latex = String(
                Base64.decode(payload, Base64.URL_SAFE),
                Charsets.UTF_8,
            )
            JLatexMathDrawable.builder(latex)
                .textSize(textSizePx)
                .color(color)
                .padding(2)
                .fitCanvas(true)
                .build()
        } catch (e: Exception) {
            android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT)
        }
        return ImageItem.withResult(drawable)
    }

    override fun supportedSchemes(): Collection<String> = listOf("latex")
}
