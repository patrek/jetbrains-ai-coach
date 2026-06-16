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
    testImplementation(libs.junit)
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
            // Pin explicit STABLE releases (no EAP) so the gate is deterministic.
            // The full 5-product matrix proves the platform-only dependency across
            // every target IDE (IDEA, PyCharm, WebStorm, GoLand, Rider). The
            // verifier downloads full IDE distributions, so CI must free disk
            // first (see .github/workflows/ci.yml).
            create(IntelliJPlatformType.IntellijIdeaCommunity, "2024.2.5")
            create(IntelliJPlatformType.PyCharmCommunity, "2024.2.5")
            create(IntelliJPlatformType.WebStorm, "2024.2.5")
            create(IntelliJPlatformType.GoLand, "2024.2.5")
            create(IntelliJPlatformType.Rider, "2024.2.5")
        }
    }

    // Marketplace signing & publishing. Credentials are supplied via environment
    // variables (CI secrets) — never committed. With them unset, `buildPlugin`
    // still works; only `signPlugin`/`publishPlugin` require them.
    //   CERTIFICATE_CHAIN      PEM chain for the signing certificate
    //   PRIVATE_KEY            PEM-encoded private key
    //   PRIVATE_KEY_PASSWORD   password protecting the private key
    //   PUBLISH_TOKEN          JetBrains Marketplace personal access token
    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }

    publishing {
        token = providers.environmentVariable("PUBLISH_TOKEN")
    }
}

kotlin {
    jvmToolchain(21)
}

// ---------------------------------------------------------------------------
// Sidecar + webview bundles -> plugin JAR resources.
//
// The Node sidecar bundles (main.js + workers, rules/metrics assets) and the
// browser webview bundle (app.js + styles.css) are produced by the sidecar's
// esbuild config (`sidecar/npm run build`). They are NOT committed (dist/ is
// gitignored); the JAR is the single source of truth at runtime:
//   - `sidecar/*`  is extracted by SidecarService to runtime/<version>/ and run.
//   - `webview/*`  is served to JCEF by AssetSchemeHandler (alongside the
//                  committed index.html / bootstrap.js).
//
// `buildSidecar` runs the bundler; `processResources` folds its output in. It
// is wired into resource processing (jar/buildPlugin), not compileKotlin, so a
// plain `compileKotlin` needs no Node toolchain.
// ---------------------------------------------------------------------------
val sidecarDir = rootProject.projectDir.resolve("sidecar")
val sidecarDist = sidecarDir.resolve("dist")
val npmExecutable = if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) "npm.cmd" else "npm"

val buildSidecar by tasks.registering(Exec::class) {
    group = "build"
    description = "Builds the Node sidecar and webview bundles via esbuild."
    workingDir = sidecarDir
    commandLine(npmExecutable, "run", "build")
}

tasks.processResources {
    dependsOn(buildSidecar)
    // Node sidecar runtime: the IDE entry, the standalone MCP entry, the workers,
    // and the markdown rule/metric assets. `mcp-main.js` is the IDE-closed MCP
    // server an external client launches from `runtime/current/` (ADR 0002).
    from(sidecarDist) {
        into("sidecar")
        include("main.js", "mcp-main.js", "*-worker.js", "rules/**", "metrics/**")
    }
    // Browser webview bundle served by the custom scheme handler.
    from(sidecarDist.resolve("webview")) {
        into("webview")
        include("app.js", "styles.css")
    }
}
