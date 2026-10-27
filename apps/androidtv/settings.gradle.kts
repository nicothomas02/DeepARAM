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

rootProject.name = "DeepARAM TV"
include(":app")
// Shared Android code (Riot notice, patch checks) from the phone app's project.
include(":core")
project(":core").projectDir = file("../android/core")
