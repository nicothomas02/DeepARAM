package com.deeparam.app

import android.app.Application

class DeepARAMApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        PatchAlerts.createChannel(this)
        if (PatchAlerts.isEnabled(this)) PatchAlerts.schedule(this)
    }
}
