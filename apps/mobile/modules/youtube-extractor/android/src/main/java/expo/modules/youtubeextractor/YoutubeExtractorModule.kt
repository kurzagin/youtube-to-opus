package expo.modules.youtubeextractor

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class YoutubeExtractorModule : Module() {
    private val context: Context
        get() = appContext.reactContext ?: throw IllegalStateException("React Context not initialized")

    override fun definition() = ModuleDefinition {
        Name("YoutubeExtractor")

        AsyncFunction("initPython") {
            if (!Python.isStarted()) {
                Python.start(AndroidPlatform(context))
            }
            return@AsyncFunction true
        }

        AsyncFunction("getVideoInfo") { url: String ->
            if (!Python.isStarted()) {
                Python.start(AndroidPlatform(context))
            }
            val py = Python.getInstance()
            val ytdlpModule = py.getModule("ytdlp_runner")
            val resultJson = ytdlpModule.callAttr("get_video_info", url).toString()
            return@AsyncFunction resultJson
        }

        AsyncFunction("downloadRawStream") { url: String, tempFilePath: String ->
            if (!Python.isStarted()) {
                Python.start(AndroidPlatform(context))
            }
            val cleanPath = if (tempFilePath.startsWith("file://")) tempFilePath.removePrefix("file://") else tempFilePath
            val outFile = File(cleanPath)
            outFile.parentFile?.mkdirs()

            val py = Python.getInstance()
            val ytdlpModule = py.getModule("ytdlp_runner")
            ytdlpModule.callAttr("download_audio_stream", url, cleanPath)
            return@AsyncFunction true
        }

        AsyncFunction("saveToMediaStore") { tempFilePath: String, filename: String ->
            val cleanPath = if (tempFilePath.startsWith("file://")) tempFilePath.removePrefix("file://") else tempFilePath
            val srcFile = File(cleanPath)
            if (!srcFile.exists()) {
                throw IllegalStateException("Source audio file does not exist at: $cleanPath")
            }

            val values = ContentValues().apply {
                put(MediaStore.Audio.Media.DISPLAY_NAME, filename)
                put(MediaStore.Audio.Media.MIME_TYPE, "audio/ogg")
                put(MediaStore.Audio.Media.IS_PENDING, 1)

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/YouTubeOpus")
                }
            }

            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Failed to create MediaStore entry for audio")

            resolver.openOutputStream(uri)?.use { outStream ->
                FileInputStream(srcFile).use { inStream ->
                    inStream.copyTo(outStream)
                }
            }

            values.clear()
            values.put(MediaStore.Audio.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)

            return@AsyncFunction uri.toString()
        }

        AsyncFunction("getInitialSharedText") {
            val activity = appContext.currentActivity
            if (activity != null && activity.intent?.action == Intent.ACTION_SEND) {
                if (activity.intent.type?.startsWith("text/") == true) {
                    val sharedText = activity.intent.getStringExtra(Intent.EXTRA_TEXT)
                    return@AsyncFunction sharedText
                }
            }
            return@AsyncFunction null
        }
    }
}
