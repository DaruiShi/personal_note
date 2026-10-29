package site.funshare.notes

/**
 * Folder display/ordering helpers.
 *
 * The server keeps one stored order for a user's folders ([AppViewModel.folders]
 * mirrors it) plus a per-folder `pinned` flag. The app shows pinned folders
 * first — a pure display concern, so the stored order is never rewritten by
 * pinning. These functions are pure so the drawer/ordering rules can be unit
 * tested without Android.
 */

/** Pinned folders first, then the rest — each group in stored order. */
fun displayOrder(folders: List<Folder>): List<Folder> =
    folders.filter { it.pinned } + folders.filterNot { it.pinned }

/**
 * Index of the neighbour of [index] in [delta] direction that belongs to the
 * same pin group, or -1 when there is none (e.g. the top unpinned folder has
 * no folder above it while pinned folders are displayed first).
 */
fun folderNeighbourIndex(shown: List<Folder>, index: Int, delta: Int): Int {
    if (delta == 0 || index !in shown.indices) return -1
    val pinned = shown[index].pinned
    var j = index + delta
    while (j in shown.indices) {
        if (shown[j].pinned == pinned) return j
        j += delta
    }
    return -1
}

/**
 * Stored order with the entries [id] and [otherId] swapped. Swapping two
 * neighbours of the same pin group in the display order is the same swap in
 * the stored order (each group's display subsequence follows the stored
 * order), so this yields the order that makes the move show up in the drawer.
 */
fun swapFolderOrder(folders: List<Folder>, id: String, otherId: String): List<Folder> {
    val a = folders.indexOfFirst { it.id == id }
    val b = folders.indexOfFirst { it.id == otherId }
    if (a < 0 || b < 0 || a == b) return folders
    val out = folders.toMutableList()
    out[a] = folders[b]
    out[b] = folders[a]
    return out
}