package expo.modules.youtubeextractor

import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.InternalModule

class YoutubeExtractorPackage : Package {
    override fun createInternalModules(context: Context): List<InternalModule> {
        return emptyList()
    }
}
