plugins {
    id("com.android.application") version "8.7.1" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}

allprojects {
    val customBuildDir = System.getenv("GRADLE_BUILD_DIR")
    if (customBuildDir != null) {
        layout.buildDirectory.set(file("$customBuildDir/${project.name}"))
    } else if (System.getProperty("os.name").lowercase().contains("windows") && file("C:/Users/sreya/.gradle_build").exists()) {
        layout.buildDirectory.set(file("C:/Users/sreya/.gradle_build/messenger/${project.name}"))
    }
}
