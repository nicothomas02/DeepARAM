pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "DeepARAM"

// core: what every Android build of DeepARAM shares (site, web view, offline copies, patch checks).
// app: the phone, tablet and ChromeOS app.
include(":core", ":app")
