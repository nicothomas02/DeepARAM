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

rootProject.name = "DeepARAMWear"
include(":app")

// Shared with the phone app: Riot's notice and site constants.
include(":core")
project(":core").projectDir = file("../android/core")
