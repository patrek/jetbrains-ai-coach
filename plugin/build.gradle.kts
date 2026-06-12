import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
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
            // Pin explicit STABLE releases (no EAP) so the gate is deterministic
            // and fast. Covers the acceptance criterion — IDEA plus one non-IDEA
            // IDE — exercising the platform-only dependency on both.
            create(IntelliJPlatformType.IntellijIdeaCommunity, "2024.2.5")
            create(IntelliJPlatformType.PyCharmCommunity, "2024.2.5")
        }
    }
}

kotlin {
    jvmToolchain(21)
}
