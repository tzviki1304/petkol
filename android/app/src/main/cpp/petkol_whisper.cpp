// JNI bridge between app.petkol.notes.WhisperLib and whisper.cpp.
#include <jni.h>
#include <android/log.h>
#include <string>
#include <mutex>

#include "whisper.h"
#include "ggml.h"
#include "ggml-backend.h"

#define TAG "PetkolWhisper"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN,  TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

#define JNI_FN(name) Java_app_petkol_notes_WhisperLib_##name

static void log_cb(enum ggml_log_level level, const char * text, void *) {
    if (level == GGML_LOG_LEVEL_DEBUG || level == GGML_LOG_LEVEL_CONT) return;
    int prio = level == GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR
             : level == GGML_LOG_LEVEL_WARN  ? ANDROID_LOG_WARN
             : ANDROID_LOG_INFO;
    __android_log_write(prio, TAG, text);
}

static std::once_flag g_init_once;
static bool g_init_ok = false;

static std::string jstr(JNIEnv * env, jstring s) {
    if (!s) return std::string();
    const char * c = env->GetStringUTFChars(s, nullptr);
    std::string r(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return r;
}

extern "C" {

// Registers ggml backends. On arm64 the CPU backend lives in
// libggml-cpu-android_<level>.so files inside the app's native lib dir and the
// best one for this CPU is chosen at runtime.
JNIEXPORT jboolean JNICALL JNI_FN(nativeInit)(JNIEnv * env, jclass, jstring jLibDir) {
    std::string dir = jstr(env, jLibDir);
    std::call_once(g_init_once, [&]() {
        whisper_log_set(log_cb, nullptr);
        ggml_log_set(log_cb, nullptr);
#if PETKOL_BACKEND_DL
        LOGI("loading ggml backends from %s", dir.c_str());
        ggml_backend_load_all_from_path(dir.c_str());
#endif
        g_init_ok = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_CPU) != nullptr;
        LOGI("ggml init: backends=%zu cpu=%s", ggml_backend_reg_count(), g_init_ok ? "yes" : "NO");
    });
    return g_init_ok ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL JNI_FN(nativeSystemInfo)(JNIEnv * env, jclass) {
    return env->NewStringUTF(whisper_print_system_info());
}

JNIEXPORT jlong JNICALL JNI_FN(nativeLoad)(JNIEnv * env, jclass, jstring jPath, jboolean flashAttn) {
    std::string path = jstr(env, jPath);
    whisper_context_params cp = whisper_context_default_params();
    cp.use_gpu    = false;
    cp.flash_attn = flashAttn == JNI_TRUE;
    whisper_context * ctx = whisper_init_from_file_with_params(path.c_str(), cp);
    if (!ctx) LOGE("failed to load model %s", path.c_str());
    return (jlong) (intptr_t) ctx;
}

JNIEXPORT void JNICALL JNI_FN(nativeFree)(JNIEnv *, jclass, jlong handle) {
    auto * ctx = (whisper_context *) (intptr_t) handle;
    if (ctx) whisper_free(ctx);
}

// Returns UTF-8 bytes (decoded in Java so split/invalid multibyte sequences
// cannot crash NewStringUTF), or null on failure.
JNIEXPORT jbyteArray JNICALL JNI_FN(nativeTranscribe)(JNIEnv * env, jclass, jlong handle,
        jfloatArray jAudio, jstring jLang, jstring jPrompt, jint threads) {
    auto * ctx = (whisper_context *) (intptr_t) handle;
    if (!ctx || !jAudio) return nullptr;

    std::string lang   = jstr(env, jLang);
    std::string prompt = jstr(env, jPrompt);

    whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    p.n_threads        = threads > 0 ? threads : 4;
    p.translate        = false;
    p.no_context       = true;
    p.no_timestamps    = true;
    p.single_segment   = false;
    p.print_special    = false;
    p.print_progress   = false;
    p.print_realtime   = false;
    p.print_timestamps = false;
    p.suppress_blank   = true;
    p.suppress_nst     = true;
    p.language         = lang.empty() ? "he" : lang.c_str();
    p.detect_language  = false;
    p.initial_prompt   = prompt.empty() ? nullptr : prompt.c_str();
    p.temperature      = 0.0f;
    p.temperature_inc  = 0.0f;   // no temperature fallback: pure greedy, bounded time
    p.greedy.best_of   = 1;

    const jsize n = env->GetArrayLength(jAudio);
    jfloat * samples = env->GetFloatArrayElements(jAudio, nullptr);
    if (!samples) return nullptr;
    const int rc = whisper_full(ctx, p, samples, n);
    env->ReleaseFloatArrayElements(jAudio, samples, JNI_ABORT);
    if (rc != 0) {
        LOGE("whisper_full failed: %d", rc);
        return nullptr;
    }

    std::string text;
    const int ns = whisper_full_n_segments(ctx);
    for (int i = 0; i < ns; ++i) {
        const char * t = whisper_full_get_segment_text(ctx, i);
        if (t) text += t;
    }
    jbyteArray out = env->NewByteArray((jsize) text.size());
    if (out && !text.empty()) {
        env->SetByteArrayRegion(out, 0, (jsize) text.size(), (const jbyte *) text.data());
    }
    return out;
}

} // extern "C"
