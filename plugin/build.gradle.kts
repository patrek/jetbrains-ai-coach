import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    alias(libs.plugins.kotlin)
    alias(libs.plugins.intelliJPlatform)
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Develop against IntelliJ IDEA Community; the plugin depends only on the
        // platform module, so it remains installable in all JetBrains IDEs.
        intellijIdea(libs.versions.intellijIdea.get())
        testFramework(TestFrameworkType.Platform)
    }
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            // Minimum supported build: 2024.2. No upper bound so the plugin keeps
            // working on future IDE releases without a forced re-publish.
            sinceBuild = "242"
            untilBuild = provider { null }
        }
    }

    pluginVerification {
        ides {
            recommended()
        }
    }
}

kotlin {
    jvmToolchain(21)
}
