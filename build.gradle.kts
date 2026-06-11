// Root build script. All plugin code lives in the :plugin subproject; the root
// only pins the plugin versions so the version catalog resolves consistently.
plugins {
    alias(libs.plugins.kotlin) apply false
    alias(libs.plugins.intelliJPlatform) apply false
}
