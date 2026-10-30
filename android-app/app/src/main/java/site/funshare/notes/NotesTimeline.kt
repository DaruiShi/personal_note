package site.funshare.notes

import java.util.UUID

/**
 * Pure timeline-note logic — Kotlin port of the web client's
 * public/timeline.js. No Android dependencies, so unit tests run on the
 * plain JVM. Date math is delegated to [NotesLinks] (passed in where a
 * function needs it) to keep this module loadable alone.
 */
object NotesTimeline {

    /** A parsed paste candidate: a date, optional time range, its text, and whether the date was guessed. */
    data class Parsed(
        val date: String,
        val text: String,
        val guessed: Boolean = false,
        val start: String? = null,
        val end: String? = null,
    )

    /**
     * Convenient whole-period ranges for the add/edit time fields. Mirrors
     * TIME_PRESETS in public/timeline.js — keep both in sync.
     */
    data class TimePreset(val label: String, val start: String, val end: String)

    val TIME_PRESETS = listOf(
        TimePreset("Morning", "09:00", "12:00"),
        TimePreset("Noon", "12:00", "13:00"),
        TimePreset("Afternoon", "14:00", "18:00"),
        TimePreset("Evening", "18:00", "22:00"),
    )

    private val BIG = Int.MAX_VALUE / 2

    private val ISO_RE = Regex("^(\\d{4})-(\\d{2})-(\\d{2})(?=[\\s:：,，\\-—]|$)")
    private val MD_RE = "^(\\d{1,2})/(\\d{1,2})(?=[\\s:：,，\\-—]|$)".toRegex()
    private val CN_MD_RE = "^(\\d{1,2})月(\\d{1,2})[日号](?=[\\s:：,，\\-—]|$)".toRegex()
    private val REL_RE = "^(今天|昨天|前天)(?=[\\s:：,，\\-—]|$)".toRegex()
    private val WEEK_RE = "^(?:星期|周)([一二三四五六日天])(?=[\\s:：,，\\-—]|$)".toRegex()
    private val WEEKDAYS = mapOf('一' to 1, '二' to 2, '三' to 3, '四' to 4, '五' to 5, '六' to 6, '日' to 0, '天' to 0)
    private val DATE_KEY = "^\\d{4}-\\d{2}-\\d{2}$".toRegex()
    private val TIME_OK = "^([01]\\d|2[0-3]):[0-5]\\d$".toRegex()
    // leading clock: 14:00, 9:30am, 3pm, 2:00-4:30pm, 14:00–16:00, 9am~11am.
    // A bare hour is NOT a clock — to24 rejects it, so "2 people" stays text.
    private const val CLOCK = "([01]?\\d|2[0-3])(?::([0-5]\\d))?(?:\\s?([ap]))?m?"
    private val TIME_RANGE_RE =
        Regex("^$CLOCK(?:\\s*(?:[-–~]|到|至)\\s*$CLOCK)?(?=[\\s:：,，;；.。]|$)", RegexOption.IGNORE_CASE)

    /** "9" + "pm" -> 24h "HH:MM"; null for bare hours and nonsense pairs. */
    private fun to24(hRaw: String, mRaw: String?, apRaw: String?): String? {
        if (mRaw == null && apRaw == null) return null
        var h = hRaw.toInt()
        val m = mRaw ?: "00"
        if (apRaw != null) {
            if (h > 12) return null // "14am" is not a clock
            val pm = apRaw.equals("p", ignoreCase = true)
            if (pm && h < 12) h += 12
            if (!pm && h == 12) h = 0 // 12am == 00:00
        }
        if (h > 23) return null
        return "${pad2(h)}:$m"
    }

    /* ------------------------------------------------------------ ordering */

    /**
     * Display order within one date: explicit `order` wins (drag writes it;
     * absent order sinks), then the start time (untimed last), then
     * createdAt. Mirrors the server comparator exactly.
     */
    private fun cmpWithinDate(a: TimelineItem, b: TimelineItem): Int {
        val oa = a.order ?: BIG
        val ob = b.order ?: BIG
        if (oa != ob) return oa.compareTo(ob)
        val sa = a.start ?: "99:99"
        val sb = b.start ?: "99:99"
        if (sa != sb) return sa.compareTo(sb)
        return a.createdAt.compareTo(b.createdAt)
    }

    fun sortItems(items: List<TimelineItem>): List<TimelineItem> =
        items.sortedWith { a, b -> a.date.compareTo(b.date).takeIf { it != 0 } ?: cmpWithinDate(a, b) }

    fun groupByDate(items: List<TimelineItem>): List<Pair<String, List<TimelineItem>>> {
        val map = linkedMapOf<String, MutableList<TimelineItem>>()
        for (it in sortItems(items)) map.getOrPut(it.date) { mutableListOf() }.add(it)
        return map.map { (d, list) -> d to list.toList() }
    }

    /** Sorted unique union of item dates, today, and visited date keys. */
    fun pageDates(items: List<TimelineItem>, today: String, visited: Set<String>): List<String> {
        val set = items.map { it.date }.toMutableSet()
        set.add(today)
        set.addAll(visited.filter { DATE_KEY.matches(it) })
        return set.sorted()
    }

    /* ------------------------------------------------------ item editing */

    fun makeItem(
        date: String,
        text: String,
        now: Long = System.currentTimeMillis(),
        start: String? = null,
        end: String? = null,
    ): TimelineItem = TimelineItem(
        id = "tmp:" + UUID.randomUUID().toString(),
        date = date,
        text = text.trim(),
        start = start?.takeIf { TIME_OK.matches(it) },
        end = end?.takeIf { TIME_OK.matches(it) },
        done = false,
        createdAt = now,
        updatedAt = now,
    )

    /**
     * Insert a new item at its policy position — timed items slot among
     * the date's items by start time, untimed items append at the end —
     * and renumber that date so the sequence persists on save.
     */
    fun insertItem(items: List<TimelineItem>, item: TimelineItem): List<TimelineItem> =
        renumberByPolicy(items + item, item)

    private fun renumberByPolicy(items: List<TimelineItem>, item: TimelineItem): List<TimelineItem> {
        val siblings = items.filter { it.date == item.date && it.id != item.id }.sortedWith(::cmpWithinDate)
        var idx = siblings.size
        if (item.start != null) {
            // after the last TIMED sibling starting at-or-before ours;
            // untimed siblings keep their (possibly dragged) order
            idx = 0
            for (i in siblings.indices) {
                val s = siblings[i].start ?: continue
                if (s <= item.start!!) idx = i + 1
            }
        }
        val ordered = siblings.subList(0, idx) + item + siblings.subList(idx, siblings.size)
        val orders = ordered.mapIndexed { i, it -> it.id to i }.toMap()
        return items.map { if (orders.containsKey(it.id)) it.copy(order = orders[it.id]) else it }
    }

    /**
     * Drag-and-drop: move an item within its date before `beforeId`
     * (or to the end when null), renumbering that date.
     */
    fun moveWithinDate(items: List<TimelineItem>, id: String, beforeId: String?): List<TimelineItem> {
        val item = items.firstOrNull { it.id == id } ?: return items
        if (id == beforeId) return items
        val siblings = items.filter { it.date == item.date && it.id != id }.sortedWith(::cmpWithinDate)
        var idx = siblings.size
        if (beforeId != null) {
            val at = siblings.indexOfFirst { it.id == beforeId }
            if (at >= 0) idx = at
        }
        val ordered = siblings.subList(0, idx) + item + siblings.subList(idx, siblings.size)
        val orders = ordered.mapIndexed { i, it -> it.id to i }.toMap()
        val now = System.currentTimeMillis()
        return items.map {
            when {
                it.id == id -> it.copy(order = orders[id], updatedAt = now)
                orders.containsKey(it.id) -> it.copy(order = orders[it.id])
                else -> it
            }
        }
    }

    /**
     * Set an item's time range and re-slot it in its date by the new
     * start (cleared times send the item to the end).
     */
    fun updateItemTime(items: List<TimelineItem>, id: String, start: String?, end: String?): List<TimelineItem> {
        val item = items.firstOrNull { it.id == id } ?: return items
        val changed = item.copy(
            start = start?.takeIf { TIME_OK.matches(it) },
            end = end?.takeIf { TIME_OK.matches(it) },
            updatedAt = System.currentTimeMillis(),
        )
        return renumberByPolicy(items.filterNot { it.id == id } + changed, changed)
    }

    fun updateText(items: List<TimelineItem>, id: String, text: String, now: Long = System.currentTimeMillis()): List<TimelineItem> =
        items.map { if (it.id == id) it.copy(text = text.trim(), updatedAt = now) else it }

    fun move(items: List<TimelineItem>, id: String, date: String, now: Long = System.currentTimeMillis()): List<TimelineItem> {
        val item = items.firstOrNull { it.id == id } ?: return items
        val changed = item.copy(date = date, updatedAt = now)
        return renumberByPolicy(items.filterNot { it.id == id } + changed, changed)
    }

    fun remove(items: List<TimelineItem>, id: String): List<TimelineItem> =
        items.filterNot { it.id == id }

    fun toggleDone(items: List<TimelineItem>, id: String, now: Long = System.currentTimeMillis()): List<TimelineItem> =
        items.map { if (it.id == id) it.copy(done = !it.done, updatedAt = now) else it }

    /**
     * Append parsed items, skipping an incoming item when an existing one
     * has the same date and whitespace-normalised text — a double confirm
     * or a retry must not duplicate rows. Times ride along.
     */
    fun mergeParsed(existing: List<TimelineItem>, incoming: List<Parsed>): List<TimelineItem> {
        val norm = { s: String -> s.replace(Regex("\\s+"), " ").trim() }
        val have = existing.map { "${it.date}\u0000${norm(it.text)}" }.toMutableSet()
        var out = existing
        for (p in incoming) {
            val key = "${p.date}\u0000${norm(p.text)}"
            if (!have.add(key)) continue
            out = insertItem(out, makeItem(p.date, p.text, start = p.start, end = p.end))
        }
        return out
    }

    /* ------------------------------------------------- fallback parser */

    private fun isRealDate(y: Int, m: Int, d: Int): Boolean {
        val c = java.util.Calendar.getInstance()
        c.clear()
        c.set(y, m - 1, d)
        return c.get(java.util.Calendar.YEAR) == y &&
            c.get(java.util.Calendar.MONTH) == m - 1 &&
            c.get(java.util.Calendar.DAY_OF_MONTH) == d
    }

    private fun pad2(n: Int) = n.toString().padStart(2, '0')

    /**
     * Deterministic local parser for when the LLM is unavailable: one item
     * per non-empty line; a leading date token selects the date, otherwise
     * today (flagged guessed). [addDays] is NotesLinks::addDays.
     */
    fun parseFallback(text: String, today: String, addDays: (String, Int) -> String?): List<Parsed> {
        if (text.isBlank()) return emptyList()
        val parts = today.split("-").map { it.toInt() }
        val (ty, tm, td) = Triple(parts[0], parts[1], parts[2])
        val cal = java.util.Calendar.getInstance()
        cal.clear()
        cal.set(ty, tm - 1, td)
        val todayDow = cal.get(java.util.Calendar.DAY_OF_WEEK) - 1 // 0=Sun
        val out = mutableListOf<Parsed>()
        for (raw in text.split("\n")) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            var date = today
            var rest = line
            var matched = false
            val iso = ISO_RE.find(line)
            val cn = CN_MD_RE.find(line)
            val md = MD_RE.find(line)
            val rel = REL_RE.find(line)
            val week = WEEK_RE.find(line)
            when {
                iso != null && isRealDate(iso.groupValues[1].toInt(), iso.groupValues[2].toInt(), iso.groupValues[3].toInt()) -> {
                    date = iso.groupValues[0]; rest = line.substring(iso.groupValues[0].length); matched = true
                }
                cn != null && cn.groupValues[1].toInt() in 1..12 && isRealDate(ty, cn.groupValues[1].toInt(), cn.groupValues[2].toInt()) -> {
                    date = "$ty-${pad2(cn.groupValues[1].toInt())}-${pad2(cn.groupValues[2].toInt())}"
                    rest = line.substring(cn.groupValues[0].length); matched = true
                }
                md != null && md.groupValues[1].toInt() in 1..12 && isRealDate(ty, md.groupValues[1].toInt(), md.groupValues[2].toInt()) -> {
                    date = "$ty-${pad2(md.groupValues[1].toInt())}-${pad2(md.groupValues[2].toInt())}"
                    rest = line.substring(md.groupValues[0].length); matched = true
                }
                rel != null -> {
                    date = when (rel.groupValues[1]) {
                        "今天" -> today
                        "昨天" -> addDays(today, -1) ?: today
                        else -> addDays(today, -2) ?: today
                    }
                    rest = line.substring(rel.groupValues[0].length); matched = true
                }
                week != null -> {
                    val target = WEEKDAYS[week.groupValues[1][0]] ?: 0
                    val back = ((todayDow - target) + 7) % 7
                    date = if (back == 0) today else addDays(today, -back) ?: today
                    rest = line.substring(week.groupValues[0].length); matched = true
                }
            }
            // optional leading time range after the date token
            var start: String? = null
            var end: String? = null
            val stripped = rest.replace("^[\\s:：,，\\-—]+".toRegex(), "")
            val tm = TIME_RANGE_RE.find(stripped)
            if (tm != null) {
                val g = tm.groupValues
                val c1 = to24(g[1], g[2].ifEmpty { null }, g[3].ifEmpty { null })
                val hasEnd = g[4].isNotEmpty()
                val c2 = if (hasEnd) to24(g[4], g[5].ifEmpty { null }, g[6].ifEmpty { null }) else null
                if (c1 != null && (!hasEnd || (c2 != null && c2 >= c1))) {
                    start = c1
                    end = c2
                    rest = stripped.substring(tm.groupValues[0].length)
                }
            }
            val cleaned = rest.replace("^[\\s:：,，\\-—]+".toRegex(), "").trim()
            out.add(Parsed(date, (cleaned.ifEmpty { line }).trim(), !matched, start, end))
        }
        return out
    }

    /* --------------------------------------------------------- summary */

    data class Summary(val total: Int, val dates: Int, val first: String?, val last: String?)

    fun summarize(items: List<TimelineItem>): Summary {
        val dates = items.map { it.date }.distinct().sorted()
        return Summary(items.size, dates.size, dates.firstOrNull(), dates.lastOrNull())
    }
}
