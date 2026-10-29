package site.funshare.notes

import android.app.Application

class NotesApp : Application() {
    lateinit var store: Store
        private set

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
    }
}
